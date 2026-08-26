import type Database from "better-sqlite3";
import { proposeConcern } from "../ledger/concerns";
import { CostCapError } from "../ledger/cost";
import { recordModelCall } from "../ledger/model-calls";
import { createProject, createSession } from "../ledger/projects";
import {
  extractionOutputSchema,
  nextQuestionOutputSchema,
  type ModelExecutionProvenance,
} from "../ledger/schemas";
import { LedgerValidationError, proposeStatement } from "../ledger/statements";
import type { ModelClient } from "./client";
import { modelCatalog } from "./config";
import {
  NextQuestionValidationError,
  applyNextQuestion,
} from "./next-question";

export class ExtractionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionValidationError";
  }
}

export function applyExtraction(
  db: Database.Database,
  input: {
    projectName: string;
    idea?: string;
    payload: unknown;
    executionProvenance: ModelExecutionProvenance;
  },
): { sessionId: string } {
  const parsed = extractionOutputSchema.safeParse(input.payload);
  if (!parsed.success) {
    throw new ExtractionValidationError(parsed.error.message);
  }

  const run = db.transaction(() => {
    const project = createProject(db, input.projectName, input.idea ?? "");
    const session = createSession(db, project.id);
    const call = recordModelCall(db, {
      sessionId: session.id,
      modelAlias: modelCatalog.sonnet.alias,
      executionProvenance: input.executionProvenance,
      estimatedCostCents: 0,
    });

    for (const statement of parsed.data.statements) {
      proposeStatement(db, {
        sessionId: session.id,
        kind: statement.kind,
        body: statement.body,
        provenanceSource: "model-inference",
        modelCallId: call.id,
      });
    }

    for (const concern of parsed.data.concerns) {
      proposeConcern(db, {
        sessionId: session.id,
        code: concern.code,
        coverage: concern.coverage,
        provenanceSource: "model-inference",
        modelCallId: call.id,
      });
    }

    return { sessionId: session.id };
  });

  try {
    return run();
  } catch (error) {
    if (
      error instanceof ExtractionValidationError ||
      error instanceof LedgerValidationError ||
      error instanceof CostCapError
    ) {
      throw error;
    }
    throw new ExtractionValidationError(
      error instanceof Error ? error.message : "Extraction could not be applied",
    );
  }
}

export function extractAndStartSession(
  db: Database.Database,
  input: { projectName: string; idea: string; client: ModelClient },
): { sessionId: string } {
  // Both model payloads are fetched and validated before any DB write so a
  // transaction is never held open across a model call and an invalid payload
  // leaves no partial session behind.
  const extractionPayload = input.client.extractFromIdea({
    idea: input.idea,
    projectName: input.projectName,
  });
  const extraction = extractionOutputSchema.safeParse(extractionPayload);
  if (!extraction.success) {
    throw new ExtractionValidationError(extraction.error.message);
  }

  const questionPayload = input.client.nextQuestion({
    idea: input.idea,
    projectName: input.projectName,
  });
  const question = nextQuestionOutputSchema.safeParse(questionPayload);
  if (!question.success) {
    throw new NextQuestionValidationError(question.error.message);
  }

  const run = db.transaction(() => {
    const { sessionId } = applyExtraction(db, {
      projectName: input.projectName,
      idea: input.idea,
      payload: extractionPayload,
      executionProvenance: input.client.executionProvenance,
    });
    applyNextQuestion(db, {
      sessionId,
      payload: questionPayload,
      executionProvenance: input.client.executionProvenance,
    });
    return { sessionId };
  });

  return run();
}
