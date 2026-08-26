import type Database from "better-sqlite3";
import { CostCapError } from "../ledger/cost";
import { recordModelCall } from "../ledger/model-calls";
import { proposeQuestion } from "../ledger/questions";
import {
  nextQuestionOutputSchema,
  type ModelExecutionProvenance,
} from "../ledger/schemas";
import { LedgerValidationError } from "../ledger/statements";
import type { ModelClient } from "./client";
import { modelCatalog } from "./config";

export class NextQuestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NextQuestionValidationError";
  }
}

export function applyNextQuestion(
  db: Database.Database,
  input: {
    sessionId: string;
    payload: unknown;
    executionProvenance: ModelExecutionProvenance;
  },
): { questionId: string } {
  const parsed = nextQuestionOutputSchema.safeParse(input.payload);
  if (!parsed.success) {
    throw new NextQuestionValidationError(parsed.error.message);
  }

  const run = db.transaction(() => {
    const call = recordModelCall(db, {
      sessionId: input.sessionId,
      modelAlias: modelCatalog.fable.alias,
      executionProvenance: input.executionProvenance,
      estimatedCostCents: 0,
    });

    const question = proposeQuestion(db, {
      sessionId: input.sessionId,
      body: parsed.data.body,
      whySelected: parsed.data.whySelected,
      provenanceSource: "model-inference",
      modelCallId: call.id,
    });

    return { questionId: question.id };
  });

  try {
    return run();
  } catch (error) {
    if (
      error instanceof NextQuestionValidationError ||
      error instanceof LedgerValidationError ||
      error instanceof CostCapError
    ) {
      throw error;
    }
    throw new NextQuestionValidationError(
      error instanceof Error ? error.message : "Next question could not be applied",
    );
  }
}

export function askNextQuestion(
  db: Database.Database,
  input: {
    sessionId: string;
    idea: string;
    projectName: string;
    client: ModelClient;
  },
): { questionId: string } {
  const payload = input.client.nextQuestion({
    idea: input.idea,
    projectName: input.projectName,
  });
  return applyNextQuestion(db, {
    sessionId: input.sessionId,
    payload,
    executionProvenance: input.client.executionProvenance,
  });
}
