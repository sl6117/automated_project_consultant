import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import { CostCapError } from "../../../src/server/ledger/cost";
import {
  beginModelAttempt,
  getModelAttempt,
  sessionSpend,
  settleModelAttempt,
} from "../../../src/server/ledger/model-attempts";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import { LedgerValidationError } from "../../../src/server/ledger/statements";

const CENT = 1_000_000;

function seedSession(capCents = 100) {
  const db = openMemoryLedger();
  const project = createProject(db, "Cap check");
  const session = createSession(db, project.id, capCents);
  return { db, sessionId: session.id };
}

function begin(
  db: ReturnType<typeof openMemoryLedger>,
  sessionId: string,
  estimatedCostMicrocents: number,
  confirmedOverCap?: boolean,
) {
  return beginModelAttempt(db, {
    sessionId,
    modelAlias: "fable",
    executionProvenance: "live",
    estimatedCostMicrocents,
    confirmedOverCap,
    apiModelId: "claude-fable-5",
    priceEffectiveDate: "2026-08-26",
  });
}

describe("beginModelAttempt", () => {
  test("inserts a pending attempt with the audit fields", () => {
    const { db, sessionId } = seedSession();

    const attempt = begin(db, sessionId, 40 * CENT);

    expect(attempt.status).toBe("pending");
    expect(attempt.estimated_cost_microcents).toBe(40 * CENT);
    expect(attempt.actual_cost_microcents).toBeNull();
    expect(attempt.confirmed_over_cap).toBe(0);
    expect(attempt.api_model_id).toBe("claude-fable-5");
    expect(attempt.price_effective_date).toBe("2026-08-26");
    expect(attempt.execution_provenance).toBe("live");
    expect(attempt.recorded).toBe(0);
  });

  test("pending estimates reserve budget against the session cap", () => {
    const { db, sessionId } = seedSession(100);
    begin(db, sessionId, 90 * CENT);

    expect(() => begin(db, sessionId, 20 * CENT)).toThrow(CostCapError);

    const spend = sessionSpend(db, sessionId);
    expect(spend.reservedEstimateMicrocents).toBe(90 * CENT);
    expect(spend.settledActualMicrocents).toBe(0);
  });

  test("explicit confirmation is the only way past the cap and is persisted", () => {
    const { db, sessionId } = seedSession(100);
    begin(db, sessionId, 90 * CENT);

    const over = begin(db, sessionId, 20 * CENT, true);
    expect(over.confirmed_over_cap).toBe(1);
    expect(sessionSpend(db, sessionId).reservedEstimateMicrocents).toBe(
      110 * CENT,
    );
  });

  test("rejects an unknown session and an unknown alias", () => {
    const { db, sessionId } = seedSession();

    expect(() =>
      beginModelAttempt(db, {
        sessionId: "missing",
        modelAlias: "fable",
        executionProvenance: "live",
        estimatedCostMicrocents: 0,
        apiModelId: "claude-fable-5",
        priceEffectiveDate: "2026-08-26",
      }),
    ).toThrow(LedgerValidationError);
    expect(() =>
      beginModelAttempt(db, {
        sessionId,
        modelAlias: "haiku" as never,
        executionProvenance: "live",
        estimatedCostMicrocents: 0,
        apiModelId: "claude-haiku",
        priceEffectiveDate: "2026-08-26",
      }),
    ).toThrow(LedgerValidationError);
  });
});

describe("settleModelAttempt", () => {
  test("settling replaces the reserved estimate with the actual", () => {
    const { db, sessionId } = seedSession(100);
    const attempt = begin(db, sessionId, 90 * CENT);

    const settled = settleModelAttempt(db, {
      attemptId: attempt.id,
      outcome: "succeeded",
      actualCostMicrocents: 30 * CENT,
      latencyMs: 1200,
      inputTokens: 800,
      outputTokens: 200,
      cacheReadTokens: 500,
      cacheWrite5mTokens: 100,
      cacheWrite1hTokens: 50,
    });

    expect(settled.status).toBe("succeeded");
    expect(settled.actual_cost_microcents).toBe(30 * CENT);
    expect(settled.latency_ms).toBe(1200);
    expect(settled.cache_write_5m_tokens).toBe(100);
    expect(settled.cache_write_1h_tokens).toBe(50);

    const spend = sessionSpend(db, sessionId);
    expect(spend.reservedEstimateMicrocents).toBe(0);
    expect(spend.settledActualMicrocents).toBe(30 * CENT);

    // The freed headroom admits a call the estimate would have blocked.
    expect(() => begin(db, sessionId, 60 * CENT)).not.toThrow();
  });

  test("a validation_failed settle keeps the real spend canonical", () => {
    const { db, sessionId } = seedSession(100);
    const attempt = begin(db, sessionId, 50 * CENT);

    settleModelAttempt(db, {
      attemptId: attempt.id,
      outcome: "validation_failed",
      actualCostMicrocents: 45 * CENT,
      latencyMs: 900,
    });

    const spend = sessionSpend(db, sessionId);
    expect(spend.settledActualMicrocents).toBe(45 * CENT);
    expect(spend.reservedEstimateMicrocents).toBe(0);
  });

  test("a transport failure keeps a NULL actual and its estimate reserved", () => {
    const { db, sessionId } = seedSession(100);
    const attempt = begin(db, sessionId, 40 * CENT);

    const settled = settleModelAttempt(db, {
      attemptId: attempt.id,
      outcome: "transport_failed",
      latencyMs: 800,
    });

    expect(settled.status).toBe("transport_failed");
    expect(settled.actual_cost_microcents).toBeNull();

    // Unknown spend counts as reserved, never as used.
    const spend = sessionSpend(db, sessionId);
    expect(spend.settledActualMicrocents).toBe(0);
    expect(spend.reservedEstimateMicrocents).toBe(40 * CENT);

    // The reservation still constrains the cap.
    expect(() => begin(db, sessionId, 70 * CENT)).toThrow(CostCapError);
  });

  test("settle inputs match their outcome: transport has no actual, others require one", () => {
    const { db, sessionId } = seedSession();
    const first = begin(db, sessionId, CENT);
    const second = begin(db, sessionId, CENT);

    expect(() =>
      settleModelAttempt(db, {
        attemptId: first.id,
        outcome: "transport_failed",
        actualCostMicrocents: 5,
        latencyMs: 10,
      }),
    ).toThrow(LedgerValidationError);
    expect(() =>
      settleModelAttempt(db, {
        attemptId: second.id,
        outcome: "succeeded",
        latencyMs: 10,
      }),
    ).toThrow(LedgerValidationError);
    expect(getModelAttempt(db, first.id).status).toBe("pending");
    expect(getModelAttempt(db, second.id).status).toBe("pending");
  });

  test("an attempt can only be settled once", () => {
    const { db, sessionId } = seedSession();
    const attempt = begin(db, sessionId, CENT);
    settleModelAttempt(db, {
      attemptId: attempt.id,
      outcome: "transport_failed",
      latencyMs: 10,
    });

    expect(() =>
      settleModelAttempt(db, {
        attemptId: attempt.id,
        outcome: "succeeded",
        actualCostMicrocents: 0,
        latencyMs: 10,
      }),
    ).toThrow(LedgerValidationError);
    expect(getModelAttempt(db, attempt.id).status).toBe("transport_failed");
  });

  test("rejects an unknown outcome and an unknown attempt", () => {
    const { db, sessionId } = seedSession();
    const attempt = begin(db, sessionId, CENT);

    expect(() =>
      settleModelAttempt(db, {
        attemptId: attempt.id,
        outcome: "pending" as never,
        actualCostMicrocents: 0,
        latencyMs: 0,
      }),
    ).toThrow(LedgerValidationError);
    expect(() =>
      settleModelAttempt(db, {
        attemptId: "missing",
        outcome: "succeeded",
        actualCostMicrocents: 0,
        latencyMs: 0,
      }),
    ).toThrow(LedgerValidationError);
  });
});
