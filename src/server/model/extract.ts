import type Database from "better-sqlite3";
import { proposeConcern } from "../ledger/concerns";
import { CostCapError } from "../ledger/cost";
import { createProject, createSession } from "../ledger/projects";
import {
  extractionOutputSchema,
  type ExtractionOutput,
  type SessionInitializationStatus,
} from "../ledger/schemas";
import { LedgerValidationError, proposeStatement } from "../ledger/statements";
import { ModelTransportError, runModelAttempt } from "./attempt-runner";
import type { ModelClient } from "./client";
import { describeExtractionRequest } from "./prompt";

export class ExtractionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionValidationError";
  }
}

export type SessionStartResult = {
  sessionId: string;
  initializationStatus: SessionInitializationStatus;
  failure:
    | "extraction-validation"
    | "content-ledger"
    | "transport"
    | "cost-cap"
    | null;
};

export function parseExtraction(payload: unknown): ExtractionOutput {
  const parsed = extractionOutputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ExtractionValidationError(parsed.error.message);
  }
  return parsed.data;
}

export function insertExtractionContent(
  db: Database.Database,
  input: {
    sessionId: string;
    extraction: ExtractionOutput;
    modelCallId: string;
  },
): void {
  for (const statement of input.extraction.statements) {
    proposeStatement(db, {
      sessionId: input.sessionId,
      kind: statement.kind,
      body: statement.body,
      provenanceSource: "model-inference",
      modelCallId: input.modelCallId,
    });
  }
  for (const concern of input.extraction.concerns) {
    proposeConcern(db, {
      sessionId: input.sessionId,
      code: concern.code,
      coverage: concern.coverage,
      provenanceSource: "model-inference",
      modelCallId: input.modelCallId,
    });
  }
}

// Starts a consultation: the session row is created first so every paid
// attempt has a place to record spend, then extraction and first-question
// content persist atomically only when both payloads validate. A failed start
// leaves an inspectable 'failed' session whose cap and spend carry into
// retries — never a fresh session per retry.
export async function extractAndStartSession(
  db: Database.Database,
  input: { projectName: string; idea: string; client: ModelClient },
): Promise<SessionStartResult> {
  const create = db.transaction(() => {
    const project = createProject(db, input.projectName, input.idea);
    return createSession(db, project.id);
  });
  const session = create();

  return runStartAttempts(db, {
    sessionId: session.id,
    projectName: input.projectName,
    idea: input.idea,
    client: input.client,
  });
}

export async function retryStartSession(
  db: Database.Database,
  input: { sessionId: string; client: ModelClient; confirmedOverCap?: boolean },
): Promise<SessionStartResult> {
  const row = db
    .prepare(
      `SELECT s.initialization_status AS initialization_status,
              p.name AS project_name, p.idea AS idea
       FROM discovery_sessions s
       JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?`,
    )
    .get(input.sessionId) as
    | { initialization_status: string; project_name: string; idea: string }
    | undefined;
  if (!row) {
    throw new LedgerValidationError(`Session ${input.sessionId} not found`);
  }
  if (row.initialization_status === "active") {
    throw new LedgerValidationError(
      `Session ${input.sessionId} is already active`,
    );
  }

  return runStartAttempts(db, {
    sessionId: input.sessionId,
    projectName: row.project_name,
    idea: row.idea,
    client: input.client,
    confirmedOverCap: input.confirmedOverCap,
  });
}

async function runStartAttempts(
  db: Database.Database,
  input: {
    sessionId: string;
    projectName: string;
    idea: string;
    client: ModelClient;
    confirmedOverCap?: boolean;
  },
): Promise<SessionStartResult> {
  const semantic = { projectName: input.projectName, idea: input.idea };

  try {
    // Session start is Sonnet extraction only. The first Fable question is
    // deferred until extraction review is clear, so the adaptive path can
    // rank against approved rows with ids.
    const request = describeExtractionRequest(semantic);
    const extraction = await runModelAttempt({
      db,
      sessionId: input.sessionId,
      alias: "sonnet",
      executionProvenance: input.client.executionProvenance,
      request,
      confirmedOverCap: input.confirmedOverCap,
      invoke: () => input.client.extractFromIdea({ ...semantic, request }),
      parse: parseExtraction,
    });

    const commit = db.transaction(() => {
      insertExtractionContent(db, {
        sessionId: input.sessionId,
        extraction: extraction.value as ExtractionOutput,
        modelCallId: extraction.attempt.id,
      });
      db.prepare(
        "UPDATE discovery_sessions SET initialization_status = 'active' WHERE id = ?",
      ).run(input.sessionId);
    });
    commit();

    return {
      sessionId: input.sessionId,
      initializationStatus: "active",
      failure: null,
    };
  } catch (error) {
    const failure = classifyStartFailure(error);
    if (!failure) {
      throw error;
    }
    db.prepare(
      "UPDATE discovery_sessions SET initialization_status = 'failed' WHERE id = ?",
    ).run(input.sessionId);
    return {
      sessionId: input.sessionId,
      initializationStatus: "failed",
      failure,
    };
  }
}

function classifyStartFailure(
  error: unknown,
): SessionStartResult["failure"] {
  if (error instanceof ExtractionValidationError) {
    return "extraction-validation";
  }
  if (error instanceof ModelTransportError) {
    return "transport";
  }
  if (error instanceof CostCapError) {
    return "cost-cap";
  }
  // Zod-valid model content the ledger layer still refuses (for example a
  // question insert colliding with an existing pending question). The content
  // transaction rolled back whole; the receipts stand.
  if (error instanceof LedgerValidationError) {
    return "content-ledger";
  }
  return null;
}
