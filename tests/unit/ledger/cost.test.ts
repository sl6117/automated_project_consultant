import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import { DEFAULT_SESSION_CAP_CENTS } from "../../../src/server/model/config";
import {
  CostCapError,
  applyEstimatedCost,
} from "../../../src/server/ledger/cost";
import { createProject, createSession } from "../../../src/server/ledger/projects";

describe("session cost cap", () => {
  test("allows spend within the default $5 cap", () => {
    const db = openMemoryLedger();
    const project = createProject(db, "Cap check");
    const session = createSession(db, project.id);

    const result = applyEstimatedCost(db, session.id, 400);

    expect(result.capCents).toBe(DEFAULT_SESSION_CAP_CENTS);
    expect(result.estimatedCostCents).toBe(400);
  });

  test("refuses a call that would exceed the cap without confirmation", () => {
    const db = openMemoryLedger();
    const project = createProject(db, "Cap check");
    const session = createSession(db, project.id);
    applyEstimatedCost(db, session.id, 400);

    expect(() => applyEstimatedCost(db, session.id, 200)).toThrow(CostCapError);

    const row = db
      .prepare(
        "SELECT estimated_cost_cents FROM discovery_sessions WHERE id = ?",
      )
      .get(session.id) as { estimated_cost_cents: number };
    expect(row.estimated_cost_cents).toBe(400);
  });

  test("allows exceeding the cap only with explicit confirmation", () => {
    const db = openMemoryLedger();
    const project = createProject(db, "Cap check");
    const session = createSession(db, project.id);
    applyEstimatedCost(db, session.id, 400);

    const result = applyEstimatedCost(db, session.id, 200, {
      confirmedOverCap: true,
    });

    expect(result.estimatedCostCents).toBe(600);
  });
});
