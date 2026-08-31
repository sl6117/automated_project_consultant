import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  appendAuthorization,
  BudgetExceededError,
  BudgetIntegrityError,
  initializeBudget,
  readBudget,
  reserveSpend,
  settleSpend,
} from "../../../src/eval/budget";

const dirs: string[] = [];
function budgetPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-budget-"));
  dirs.push(dir);
  return join(dir, "budget.jsonl");
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("phase budget record", () => {
  test("initialize, reserve, settle: remaining reflects settled actuals", () => {
    const path = budgetPath();
    initializeBudget(path, { capMicrocents: 1_000, note: "test cap" });

    const id = reserveSpend(path, {
      runId: "r",
      briefId: "b",
      role: "consultant",
      estimateMicrocents: 400,
    });
    // Reservation outstanding: counted at its estimate.
    expect(readBudget(path).remainingMicrocents).toBe(600);

    settleSpend(path, {
      reservationId: id,
      outcome: "succeeded",
      actualMicrocents: 150,
    });
    const state = readBudget(path);
    expect(state.settledActualMicrocents).toBe(150);
    expect(state.unresolvedReservationMicrocents).toBe(0);
    expect(state.remainingMicrocents).toBe(850);
    expect(state.consultantSettledMicrocents).toBe(150);
  });

  test("a missing record fails closed and is never fresh authorization", () => {
    const path = budgetPath();
    expect(() => readBudget(path)).toThrow(BudgetIntegrityError);
    expect(() => readBudget(path)).toThrow(/not fresh authorization/);
    expect(() =>
      reserveSpend(path, {
        runId: "r",
        briefId: "b",
        role: "consultant",
        estimateMicrocents: 1,
      }),
    ).toThrow(BudgetIntegrityError);
  });

  test("a truncated final line (crash mid-append) rejects the whole record", () => {
    const path = budgetPath();
    initializeBudget(path, { capMicrocents: 1_000, note: "test cap" });
    appendFileSync(path, '{"kind":"reservation","id":"x"', "utf8");
    expect(() => readBudget(path)).toThrow(/truncated/);
  });

  test("a record not starting with an authorization entry is rejected", () => {
    const path = budgetPath();
    writeFileSync(
      path,
      JSON.stringify({
        kind: "reservation",
        id: "r1",
        at: "t",
        runId: "r",
        briefId: "b",
        role: "consultant",
        estimateMicrocents: 1,
      }) + "\n",
      "utf8",
    );
    expect(() => readBudget(path)).toThrow(/authorization entry/);
  });

  test("a crash between reservation and settlement under-states, never over-states", () => {
    const path = budgetPath();
    initializeBudget(path, { capMicrocents: 1_000, note: "test cap" });
    reserveSpend(path, {
      runId: "r",
      briefId: "b",
      role: "judge",
      estimateMicrocents: 300,
    });
    // No settlement ever arrives: the estimate stays reserved forever.
    expect(readBudget(path).remainingMicrocents).toBe(700);
  });

  test("transport failures keep their reservation at the estimate", () => {
    const path = budgetPath();
    initializeBudget(path, { capMicrocents: 1_000, note: "test cap" });
    const id = reserveSpend(path, {
      runId: "r",
      briefId: "b",
      role: "consultant",
      estimateMicrocents: 250,
    });
    settleSpend(path, { reservationId: id, outcome: "transport_failed" });
    const state = readBudget(path);
    expect(state.settledActualMicrocents).toBe(0);
    expect(state.unresolvedReservationMicrocents).toBe(250);
    expect(state.remainingMicrocents).toBe(750);
  });

  test("a transport settlement claiming an actual cost is rejected", () => {
    const path = budgetPath();
    initializeBudget(path, { capMicrocents: 1_000, note: "test cap" });
    const id = reserveSpend(path, {
      runId: "r",
      briefId: "b",
      role: "consultant",
      estimateMicrocents: 10,
    });
    appendFileSync(
      path,
      JSON.stringify({
        kind: "settlement",
        at: "t",
        reservationId: id,
        outcome: "transport_failed",
        actualMicrocents: 5,
      }) + "\n",
      "utf8",
    );
    expect(() => readBudget(path)).toThrow(/cannot know/);
  });

  test("reserving beyond the remaining budget is refused before any append", () => {
    const path = budgetPath();
    initializeBudget(path, { capMicrocents: 100, note: "test cap" });
    const before = readFileSync(path, "utf8");
    expect(() =>
      reserveSpend(path, {
        runId: "r",
        briefId: "b",
        role: "consultant",
        estimateMicrocents: 101,
      }),
    ).toThrow(BudgetExceededError);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("double settlement and unknown reservations are rejected", () => {
    const path = budgetPath();
    initializeBudget(path, { capMicrocents: 1_000, note: "test cap" });
    const id = reserveSpend(path, {
      runId: "r",
      briefId: "b",
      role: "consultant",
      estimateMicrocents: 10,
    });
    settleSpend(path, {
      reservationId: id,
      outcome: "succeeded",
      actualMicrocents: 5,
    });
    appendFileSync(
      path,
      JSON.stringify({
        kind: "settlement",
        at: "t",
        reservationId: id,
        outcome: "succeeded",
        actualMicrocents: 5,
      }) + "\n",
      "utf8",
    );
    expect(() => readBudget(path)).toThrow(/settled twice/);
  });

  test("new authorization appends budget; initialize never overwrites", () => {
    const path = budgetPath();
    initializeBudget(path, { capMicrocents: 1_000, note: "initial" });
    expect(() =>
      initializeBudget(path, { capMicrocents: 5_000, note: "again" }),
    ).toThrow(/already exists/);
    appendAuthorization(path, { capMicrocents: 500, note: "owner top-up" });
    expect(readBudget(path).capMicrocents).toBe(1_500);
  });

  test("deleting settlement history cannot create budget: fewer lines, less spend known, still capped", () => {
    const path = budgetPath();
    initializeBudget(path, { capMicrocents: 1_000, note: "test cap" });
    const id = reserveSpend(path, {
      runId: "r",
      briefId: "b",
      role: "consultant",
      estimateMicrocents: 900,
    });
    settleSpend(path, {
      reservationId: id,
      outcome: "succeeded",
      actualMicrocents: 100,
    });
    // "Deleting" the settlement line leaves the reservation unresolved at its
    // FULL estimate — remaining shrinks from 900 to 100. Under-statement,
    // never over-statement.
    const lines = readFileSync(path, "utf8").trim().split("\n");
    writeFileSync(path, lines.slice(0, 2).join("\n") + "\n", "utf8");
    expect(readBudget(path).remainingMicrocents).toBe(100);
  });
});
