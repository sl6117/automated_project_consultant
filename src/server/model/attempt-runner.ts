import type Database from "better-sqlite3";
import {
  beginModelAttempt,
  settleModelAttempt,
  type ModelAttemptRow,
} from "../ledger/model-attempts";
import { modelCatalog, type ModelAlias } from "./config";
import type { ModelClientResult } from "./client";
import {
  costOfUsageMicrocents,
  estimateRequestCostMicrocents,
} from "./pricing";
import type { ModelRequestDescription } from "./prompt";
import { appendDiagnostics } from "./response-diagnostics";
import type { ModelExecutionProvenance } from "../ledger/schemas";
import { assertNoOpenTransaction } from "./transaction-guard";

export class ModelTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelTransportError";
  }
}

// The receipt/content contract for one paid call:
// 1. cap check + pending attempt row, in one short transaction, BEFORE I/O;
// 2. the model call itself, with no transaction open;
// 3. settle the attempt with actual usage, latency, and outcome — succeeded,
//    transport_failed, or validation_failed — so spend is recorded even when
//    the payload is rejected. Content persistence stays with the caller.
export async function runModelAttempt<T>(input: {
  db: Database.Database;
  sessionId: string;
  alias: ModelAlias;
  executionProvenance: ModelExecutionProvenance;
  // The exact request the client will send; the estimate is derived from it.
  request: ModelRequestDescription;
  confirmedOverCap?: boolean;
  invoke: () => Promise<ModelClientResult>;
  parse: (payload: unknown) => T;
}): Promise<{ value: T; attempt: ModelAttemptRow }> {
  const { db, alias } = input;
  const catalogEntry = modelCatalog[alias];
  const estimate = estimateRequestCostMicrocents(alias, input.request);

  assertNoOpenTransaction(db);
  const attempt = beginModelAttempt(db, {
    sessionId: input.sessionId,
    modelAlias: alias,
    executionProvenance: input.executionProvenance,
    estimatedCostMicrocents: estimate,
    confirmedOverCap: input.confirmedOverCap,
    apiModelId: catalogEntry.apiId,
    priceEffectiveDate: catalogEntry.pricing.effectiveDate,
  });

  const startedAt = Date.now();
  let result: ModelClientResult;
  try {
    assertNoOpenTransaction(db);
    result = await input.invoke();
  } catch (error) {
    // The response never arrived, so the real spend is unknown — a timeout
    // may still have been billed. The actual cost stays NULL and the
    // attempt's estimate remains counted as reserved, never as used.
    settleModelAttempt(db, {
      attemptId: attempt.id,
      outcome: "transport_failed",
      latencyMs: Date.now() - startedAt,
    });
    throw new ModelTransportError(
      error instanceof Error ? error.message : "Model call failed",
    );
  }
  const latencyMs = Date.now() - startedAt;
  const usage = result.usage;
  const actualCostMicrocents = usage
    ? costOfUsageMicrocents(alias, usage)
    : 0;

  // Only the parse itself decides validation failure. Settlement runs outside
  // this catch so a database error while settling propagates as what it is
  // instead of being mislabeled a model validation failure.
  let value: T;
  try {
    value = input.parse(result.payload);
  } catch (error) {
    // Real spend survives validation failure; content does not.
    settleModelAttempt(db, {
      attemptId: attempt.id,
      outcome: "validation_failed",
      actualCostMicrocents,
      latencyMs,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      cacheReadTokens: usage?.cacheReadTokens,
      cacheWrite5mTokens: usage?.cacheWrite5mTokens,
      cacheWrite1hTokens: usage?.cacheWrite1hTokens,
    });
    // A billed response that fails validation states its own cause —
    // truncation, refusal, string root, malformed JSON — when the client
    // supplied response diagnostics. The error's class is preserved.
    appendDiagnostics(error, result.diagnostics);
    throw error;
  }

  const settled = settleModelAttempt(db, {
    attemptId: attempt.id,
    outcome: "succeeded",
    actualCostMicrocents,
    latencyMs,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    cacheReadTokens: usage?.cacheReadTokens,
    cacheWrite5mTokens: usage?.cacheWrite5mTokens,
    cacheWrite1hTokens: usage?.cacheWrite1hTokens,
  });
  return { value, attempt: settled };
}
