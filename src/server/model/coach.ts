import type Database from "better-sqlite3";
import { proposeCoachNote, type CoachNoteRow } from "../ledger/coach-notes";
import { CostCapError } from "../ledger/cost";
import { recordModelCall } from "../ledger/model-calls";
import { getQuestion } from "../ledger/questions";
import {
  coachOutputSchema,
  type ModelExecutionProvenance,
} from "../ledger/schemas";
import { LedgerValidationError } from "../ledger/statements";
import type { ModelClient } from "./client";
import { modelCatalog } from "./config";

export class CoachValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoachValidationError";
  }
}

export function applyCoachNote(
  db: Database.Database,
  input: {
    sessionId: string;
    questionId?: string;
    payload: unknown;
    executionProvenance: ModelExecutionProvenance;
  },
): { note: CoachNoteRow } {
  const parsed = coachOutputSchema.safeParse(input.payload);
  if (!parsed.success) {
    throw new CoachValidationError(parsed.error.message);
  }

  const run = db.transaction(() => {
    const call = recordModelCall(db, {
      sessionId: input.sessionId,
      modelAlias: modelCatalog.fable.alias,
      executionProvenance: input.executionProvenance,
      estimatedCostCents: 0,
    });

    const note = proposeCoachNote(db, {
      ...parsed.data,
      sessionId: input.sessionId,
      questionId: input.questionId,
      provenanceSource: "model-inference",
      modelCallId: call.id,
    });

    return { note };
  });

  try {
    return run();
  } catch (error) {
    if (
      error instanceof CoachValidationError ||
      error instanceof LedgerValidationError ||
      error instanceof CostCapError
    ) {
      throw error;
    }
    throw new CoachValidationError(
      error instanceof Error ? error.message : "Coach note could not be applied",
    );
  }
}

// The model call happens before any transaction opens: a rollback cannot
// un-spend a model call, and an open transaction must not wait on model I/O.
export function requestCoaching(
  db: Database.Database,
  input: { questionId: string; client: ModelClient },
): { note: CoachNoteRow; sessionId: string } {
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

  const payload = input.client.coachRecommendation({
    idea: context.idea,
    projectName: context.project_name,
    questionBody: question.body,
  });

  const { note } = applyCoachNote(db, {
    sessionId: question.session_id,
    questionId: question.id,
    payload,
    executionProvenance: input.client.executionProvenance,
  });

  return { note, sessionId: question.session_id };
}
