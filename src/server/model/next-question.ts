import type Database from "better-sqlite3";
import { proposeQuestion, type QuestionRow } from "../ledger/questions";
import {
  fableEnvelopeSchema,
  nextQuestionOutputSchema,
  type NextQuestionOutput,
} from "../ledger/schemas";

export class NextQuestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NextQuestionValidationError";
  }
}

export function parseNextQuestion(payload: unknown): NextQuestionOutput {
  const envelope = fableEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new NextQuestionValidationError(envelope.error.message);
  }
  // A valid payload under the wrong task tag is still rejected.
  if (envelope.data.task !== "next_question") {
    throw new NextQuestionValidationError(
      `Expected task next_question, got ${envelope.data.task}`,
    );
  }
  const parsed = nextQuestionOutputSchema.safeParse(envelope.data.payload);
  if (!parsed.success) {
    throw new NextQuestionValidationError(parsed.error.message);
  }
  return parsed.data;
}

// Plain inserts with no transaction of their own: the caller composes them
// into one atomic content commit.
export function insertQuestionContent(
  db: Database.Database,
  input: {
    sessionId: string;
    question: NextQuestionOutput;
    modelCallId: string;
  },
): QuestionRow {
  return proposeQuestion(db, {
    sessionId: input.sessionId,
    body: input.question.body,
    whySelected: input.question.whySelected,
    provenanceSource: "model-inference",
    modelCallId: input.modelCallId,
  });
}
