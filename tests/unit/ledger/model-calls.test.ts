import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import { CostCapError } from "../../../src/server/ledger/cost";
import { recordModelCall } from "../../../src/server/ledger/model-calls";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import { LedgerValidationError } from "../../../src/server/ledger/statements";

function seedSession(capCents?: number) {
  const db = openMemoryLedger();
  const project = createProject(db, "Cap check");
  const session = createSession(db, project.id, capCents);
  return { db, sessionId: session.id };
}

function sessionCost(db: ReturnType<typeof openMemoryLedger>, id: string) {
  const row = db
    .prepare("SELECT estimated_cost_cents FROM discovery_sessions WHERE id = ?")
    .get(id) as { estimated_cost_cents: number };
  return row.estimated_cost_cents;
}

describe("recordModelCall", () => {
  test("inserts the call and accumulates session cost in one step", () => {
    const { db, sessionId } = seedSession();

    const call = recordModelCall(db, {
      sessionId,
      modelAlias: "sonnet",
      executionProvenance: "recorded",
      estimatedCostCents: 40,
      inputTokens: 1200,
      outputTokens: 300,
    });

    expect(call.model_alias).toBe("sonnet");
    expect(call.execution_provenance).toBe("recorded");
    expect(call.recorded).toBe(1);
    expect(call.estimated_cost_cents).toBe(40);
    expect(sessionCost(db, sessionId)).toBe(40);
  });

  test("derives the legacy recorded flag from execution provenance", () => {
    const { db, sessionId } = seedSession();

    const synthetic = recordModelCall(db, {
      sessionId,
      modelAlias: "sonnet",
      executionProvenance: "synthetic",
      estimatedCostCents: 0,
    });
    expect(synthetic.execution_provenance).toBe("synthetic");
    expect(synthetic.recorded).toBe(1);

    const live = recordModelCall(db, {
      sessionId,
      modelAlias: "fable",
      executionProvenance: "live",
      estimatedCostCents: 0,
    });
    expect(live.execution_provenance).toBe("live");
    expect(live.recorded).toBe(0);
  });

  test("rejects an unknown execution provenance", () => {
    const { db, sessionId } = seedSession();

    expect(() =>
      recordModelCall(db, {
        sessionId,
        modelAlias: "sonnet",
        executionProvenance: "cached" as never,
        estimatedCostCents: 0,
      }),
    ).toThrow(LedgerValidationError);
  });

  test("refuses an over-cap call and writes no model_calls row", () => {
    const { db, sessionId } = seedSession(100);
    recordModelCall(db, {
      sessionId,
      modelAlias: "fable",
      executionProvenance: "recorded",
      estimatedCostCents: 90,
    });

    expect(() =>
      recordModelCall(db, {
        sessionId,
        modelAlias: "fable",
        executionProvenance: "recorded",
        estimatedCostCents: 20,
      }),
    ).toThrow(CostCapError);

    const count = db
      .prepare("SELECT COUNT(*) AS n FROM model_calls WHERE session_id = ?")
      .get(sessionId) as { n: number };
    expect(count.n).toBe(1);
    expect(sessionCost(db, sessionId)).toBe(90);
  });

  test("allows exceeding the cap only with explicit confirmation", () => {
    const { db, sessionId } = seedSession(100);
    recordModelCall(db, {
      sessionId,
      modelAlias: "fable",
      executionProvenance: "recorded",
      estimatedCostCents: 90,
    });

    const call = recordModelCall(db, {
      sessionId,
      modelAlias: "fable",
      executionProvenance: "recorded",
      estimatedCostCents: 20,
      confirmedOverCap: true,
    });

    expect(call.estimated_cost_cents).toBe(20);
    expect(sessionCost(db, sessionId)).toBe(110);
  });

  test("rejects an alias that is not in the model catalog", () => {
    const { db, sessionId } = seedSession();

    expect(() =>
      recordModelCall(db, {
        sessionId,
        modelAlias: "haiku" as never,
        executionProvenance: "recorded",
        estimatedCostCents: 0,
      }),
    ).toThrow(LedgerValidationError);
  });
});
