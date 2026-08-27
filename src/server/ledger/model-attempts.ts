import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { CostCapError } from "./cost";
import { nowIso } from "./projects";
import {
  beginModelAttemptSchema,
  settleModelAttemptSchema,
  type BeginModelAttemptInput,
  type ModelAttemptOutcome,
  type ModelExecutionProvenance,
  type SettleModelAttemptInput,
} from "./schemas";
import { LedgerValidationError } from "./statements";

export type ModelAttemptRow = {
  id: string;
  session_id: string;
  model_alias: string;
  recorded: number;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_cents: number;
  created_at: string;
  execution_provenance: ModelExecutionProvenance;
  status: ModelAttemptOutcome;
  latency_ms: number | null;
  cache_read_tokens: number | null;
  cache_write_5m_tokens: number | null;
  cache_write_1h_tokens: number | null;
  estimated_cost_microcents: number;
  actual_cost_microcents: number | null;
  confirmed_over_cap: number;
  api_model_id: string | null;
  price_effective_date: string | null;
};

export type SessionSpend = {
  capMicrocents: number;
  settledActualMicrocents: number;
  reservedEstimateMicrocents: number;
};

// Attempt rows are the canonical record of spend. The session stores only the
// cap; used/reserved spend is always derived, never accumulated on the
// session row. Used spend is the settled actuals of outcomes whose real cost
// is known; reserved spend is the estimates of pending attempts plus
// transport failures, whose real spend was never learned.
export function sessionSpend(
  db: Database.Database,
  sessionId: string,
): SessionSpend {
  const session = db
    .prepare("SELECT cap_microcents FROM discovery_sessions WHERE id = ?")
    .get(sessionId) as { cap_microcents: number } | undefined;
  if (!session) {
    throw new LedgerValidationError(`Session ${sessionId} not found`);
  }

  const totals = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('succeeded', 'validation_failed') THEN actual_cost_microcents END), 0) AS settled,
         COALESCE(SUM(CASE WHEN status IN ('pending', 'transport_failed') THEN estimated_cost_microcents END), 0) AS reserved
       FROM model_calls WHERE session_id = ?`,
    )
    .get(sessionId) as { settled: number; reserved: number };

  return {
    capMicrocents: session.cap_microcents,
    settledActualMicrocents: totals.settled,
    reservedEstimateMicrocents: totals.reserved,
  };
}

// The cap check and the pending-attempt insert share one transaction so two
// concurrent begins cannot both fit under the cap by racing the check.
export function beginModelAttempt(
  db: Database.Database,
  input: BeginModelAttemptInput,
): ModelAttemptRow {
  const parsed = beginModelAttemptSchema.safeParse(input);
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }
  const data = parsed.data;

  const run = db.transaction(() => {
    const spend = sessionSpend(db, data.sessionId);
    const reserved =
      spend.settledActualMicrocents + spend.reservedEstimateMicrocents;
    if (
      reserved + data.estimatedCostMicrocents > spend.capMicrocents &&
      !data.confirmedOverCap
    ) {
      throw new CostCapError(
        `Call would exceed the session cap of ${spend.capMicrocents} microcents`,
      );
    }

    const id = randomUUID();
    // The legacy recorded boolean is derived here and nowhere else.
    const recorded = data.executionProvenance === "live" ? 0 : 1;
    db.prepare(
      `INSERT INTO model_calls (
        id, session_id, model_alias, recorded, estimated_cost_cents,
        created_at, execution_provenance, status, estimated_cost_microcents,
        confirmed_over_cap, api_model_id, price_effective_date
      ) VALUES (?, ?, ?, ?, 0, ?, ?, 'pending', ?, ?, ?, ?)`,
    ).run(
      id,
      data.sessionId,
      data.modelAlias,
      recorded,
      nowIso(),
      data.executionProvenance,
      data.estimatedCostMicrocents,
      data.confirmedOverCap ? 1 : 0,
      data.apiModelId,
      data.priceEffectiveDate,
    );
    return getModelAttempt(db, id);
  });

  try {
    return run();
  } catch (error) {
    if (
      error instanceof LedgerValidationError ||
      error instanceof CostCapError
    ) {
      throw error;
    }
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Model attempt insert failed",
    );
  }
}

export function settleModelAttempt(
  db: Database.Database,
  input: SettleModelAttemptInput,
): ModelAttemptRow {
  const parsed = settleModelAttemptSchema.safeParse(input);
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }
  const data = parsed.data;

  const run = db.transaction(() => {
    const attempt = getModelAttempt(db, data.attemptId);
    if (attempt.status !== "pending") {
      throw new LedgerValidationError(
        `Attempt ${attempt.id} is ${attempt.status}, not pending`,
      );
    }

    db.prepare(
      `UPDATE model_calls SET
         status = ?, actual_cost_microcents = ?, latency_ms = ?,
         input_tokens = ?, output_tokens = ?, cache_read_tokens = ?,
         cache_write_5m_tokens = ?, cache_write_1h_tokens = ?
       WHERE id = ?`,
    ).run(
      data.outcome,
      data.actualCostMicrocents ?? null,
      data.latencyMs,
      data.inputTokens ?? null,
      data.outputTokens ?? null,
      data.cacheReadTokens ?? null,
      data.cacheWrite5mTokens ?? null,
      data.cacheWrite1hTokens ?? null,
      data.attemptId,
    );
    return getModelAttempt(db, data.attemptId);
  });

  try {
    return run();
  } catch (error) {
    if (error instanceof LedgerValidationError) {
      throw error;
    }
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Model attempt settle failed",
    );
  }
}

export function getModelAttempt(
  db: Database.Database,
  id: string,
): ModelAttemptRow {
  const row = db
    .prepare("SELECT * FROM model_calls WHERE id = ?")
    .get(id) as ModelAttemptRow | undefined;
  if (!row) {
    throw new LedgerValidationError(`Model attempt ${id} not found`);
  }
  return row;
}
