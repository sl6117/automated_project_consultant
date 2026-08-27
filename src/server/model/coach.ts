import type Database from "better-sqlite3";
import { proposeCoachNote, type CoachNoteRow } from "../ledger/coach-notes";
import { listConcerns } from "../ledger/concerns";
import { getQuestion } from "../ledger/questions";
import {
  coachOutputSchema,
  fableEnvelopeSchema,
  type CoachOutput,
} from "../ledger/schemas";
import { LedgerValidationError, listStatements } from "../ledger/statements";
import { runModelAttempt } from "./attempt-runner";
import type { ModelClient } from "./client";
import { describeCoachRequest } from "./prompt";

export class CoachValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoachValidationError";
  }
}

export function parseCoach(payload: unknown): CoachOutput {
  const envelope = fableEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new CoachValidationError(envelope.error.message);
  }
  // A valid payload under the wrong task tag is still rejected.
  if (envelope.data.task !== "coach") {
    throw new CoachValidationError(
      `Expected task coach, got ${envelope.data.task}`,
    );
  }
  const parsed = coachOutputSchema.safeParse(envelope.data.payload);
  if (!parsed.success) {
    throw new CoachValidationError(parsed.error.message);
  }
  return parsed.data;
}

// Coaching runs against an existing consultation. Its attempt receipt is
// recorded whatever happens, but a failure here never touches the session's
// initialization_status: a live consultation stays active.
export async function requestCoaching(
  db: Database.Database,
  input: {
    questionId: string;
    client: ModelClient;
    confirmedOverCap?: boolean;
  },
): Promise<{ note: CoachNoteRow; sessionId: string }> {
  const question = getQuestion(db, input.questionId);

  const context = db
    .prepare(
      `SELECT p.name AS project_name, p.idea AS idea
       FROM discovery_sessions s
       JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?`,
    )
    .get(question.session_id) as
    | { project_name: string; idea: string }
    | undefined;
  if (!context) {
    throw new LedgerValidationError(
      `Session ${question.session_id} not found for question ${question.id}`,
    );
  }

  // Coaching is grounded in the approved ledger, not just the raw idea:
  // approved statements and concern coverage travel with the request.
  const approvedStatements = listStatements(
    db,
    question.session_id,
    "approved",
  ).map((row) => row.body);
  const approvedConcerns = listConcerns(
    db,
    question.session_id,
    "approved",
  ).map((row) => `${row.code}: ${row.coverage}`);

  // One request description: the estimate and the client call both consume
  // the same object.
  const request = describeCoachRequest({
    projectName: context.project_name,
    idea: context.idea,
    questionBody: question.body,
    approvedStatements,
    approvedConcerns,
  });

  const { value, attempt } = await runModelAttempt({
    db,
    sessionId: question.session_id,
    alias: "fable",
    executionProvenance: input.client.executionProvenance,
    request,
    confirmedOverCap: input.confirmedOverCap,
    invoke: () =>
      input.client.coachRecommendation({
        idea: context.idea,
        projectName: context.project_name,
        questionBody: question.body,
        approvedStatements,
        approvedConcerns,
        request,
      }),
    parse: parseCoach,
  });

  const note = proposeCoachNote(db, {
    ...value,
    sessionId: question.session_id,
    questionId: question.id,
    provenanceSource: "model-inference",
    modelCallId: attempt.id,
  });

  return { note, sessionId: question.session_id };
}
