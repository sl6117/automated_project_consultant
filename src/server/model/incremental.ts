import type Database from "better-sqlite3";
import { listConcerns, proposeConcern } from "../ledger/concerns";
import { getQuestion } from "../ledger/questions";
import {
  incrementalExtractionOutputSchema,
  type IncrementalExtractionOutput,
} from "../ledger/schemas";
import {
  LedgerValidationError,
  listStatements,
  proposeStatement,
} from "../ledger/statements";
import { runModelAttempt } from "./attempt-runner";
import type { ModelClient } from "./client";
import { describeIncrementalExtractionRequest } from "./prompt";

export class IncrementalExtractionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncrementalExtractionValidationError";
  }
}

export function parseIncrementalExtraction(
  payload: unknown,
): IncrementalExtractionOutput {
  const parsed = incrementalExtractionOutputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new IncrementalExtractionValidationError(parsed.error.message);
  }
  return parsed.data;
}

// Runs after resolveQuestion has stored the answer. The answer is user truth
// and already persisted; whatever happens here — proposals, a valid empty
// payload, invalid output, transport failure — the answer stays untouched
// and nothing beyond proposed rows is ever written.
export async function proposeFromAnswer(
  db: Database.Database,
  input: {
    questionId: string;
    client: ModelClient;
    confirmedOverCap?: boolean;
  },
): Promise<{ proposedStatements: number; proposedConcerns: number }> {
  const question = getQuestion(db, input.questionId);
  if (question.status !== "answered") {
    throw new LedgerValidationError(
      `Question ${question.id} is ${question.status}, not answered`,
    );
  }
  const answer = db
    .prepare(
      "SELECT body, disposition FROM answers WHERE question_id = ? ORDER BY created_at LIMIT 1",
    )
    .get(question.id) as { body: string; disposition: string } | undefined;
  if (!answer) {
    throw new LedgerValidationError(
      `Question ${question.id} has no stored answer`,
    );
  }

  const context = db
    .prepare(
      `SELECT p.name AS project_name, p.idea AS idea
       FROM discovery_sessions s
       JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?`,
    )
    .get(question.session_id) as { project_name: string; idea: string };

  const approved = {
    statements: listStatements(db, question.session_id, "approved").map(
      (row) => ({ id: row.id, body: row.body }),
    ),
    concerns: listConcerns(db, question.session_id, "approved").map((row) => ({
      id: row.id,
      code: row.code,
      coverage: row.coverage,
    })),
  };
  const resolved = {
    questionBody: question.body,
    answerBody: answer.body,
    disposition: answer.disposition,
  };

  const request = describeIncrementalExtractionRequest({
    projectName: context.project_name,
    idea: context.idea,
    approved,
    resolved,
  });

  const { value, attempt } = await runModelAttempt({
    db,
    sessionId: question.session_id,
    alias: "sonnet",
    executionProvenance: input.client.executionProvenance,
    request,
    confirmedOverCap: input.confirmedOverCap,
    invoke: () =>
      input.client.incrementalExtraction({
        idea: context.idea,
        projectName: context.project_name,
        questionBody: question.body,
        answerBody: answer.body,
        disposition: answer.disposition,
        request,
      }),
    parse: parseIncrementalExtraction,
  });

  // A valid empty payload persists nothing and is not an error.
  if (value.statements.length === 0 && value.concerns.length === 0) {
    return { proposedStatements: 0, proposedConcerns: 0 };
  }

  const commit = db.transaction(() => {
    for (const statement of value.statements) {
      proposeStatement(db, {
        sessionId: question.session_id,
        kind: statement.kind,
        body: statement.body,
        provenanceSource: "model-inference",
        modelCallId: attempt.id,
      });
    }
    for (const concern of value.concerns) {
      proposeConcern(db, {
        sessionId: question.session_id,
        code: concern.code,
        coverage: concern.coverage,
        provenanceSource: "model-inference",
        modelCallId: attempt.id,
      });
    }
  });
  commit();

  return {
    proposedStatements: value.statements.length,
    proposedConcerns: value.concerns.length,
  };
}
