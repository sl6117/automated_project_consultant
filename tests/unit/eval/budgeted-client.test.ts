import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ModelClient } from "../../../src/server/model/client";
import { estimateRequestCostMicrocents } from "../../../src/server/model/pricing";
import { describeExtractionRequest } from "../../../src/server/model/prompt";
import { initializeBudget, readBudget } from "../../../src/eval/budget";
import {
  createBudgetedModelClient,
  PerBriefCapError,
} from "../../../src/eval/budgeted-client";

const usage = {
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
};

function innerClient(result: {
  usage: typeof usage | null;
}): ModelClient {
  return {
    executionProvenance: "synthetic",
    async extractFromIdea() {
      return { payload: {}, usage: result.usage };
    },
    async incrementalExtraction() {
      return { payload: {}, usage: result.usage };
    },
    async nextQuestion() {
      return { payload: {}, usage: result.usage };
    },
    async coachRecommendation() {
      return { payload: {}, usage: result.usage };
    },
  };
}

const extractionInput = () => ({
  idea: "an idea",
  projectName: "P",
  request: describeExtractionRequest({ idea: "an idea", projectName: "P" }),
});

const dirs: string[] = [];
function budgetPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-budgeted-"));
  dirs.push(dir);
  return join(dir, "budget.jsonl");
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scope(path: string, perBriefCapMicrocents: number) {
  return {
    budgetPath: path,
    runId: "run-one",
    briefId: "alpha",
    perBriefCapMicrocents,
  };
}

describe("budgeted model client", () => {
  test("a successful call settles its real cost", async () => {
    const path = budgetPath();
    initializeBudget(path, { capMicrocents: 1_500_000_000, note: "test" });
    const client = createBudgetedModelClient(
      innerClient({ usage }),
      scope(path, 150_000_000),
    );
    await client.extractFromIdea(extractionInput());
    const state = readBudget(path);
    expect(state.settledActualMicrocents).toBeGreaterThan(0);
    expect(state.unresolvedReservationMicrocents).toBe(0);
  });

  test("a call that resolves without usage fails closed: reservation kept at estimate", async () => {
    const path = budgetPath();
    initializeBudget(path, { capMicrocents: 1_500_000_000, note: "test" });
    const client = createBudgetedModelClient(
      innerClient({ usage: null }),
      scope(path, 150_000_000),
    );
    await expect(client.extractFromIdea(extractionInput())).rejects.toThrow(
      /without usage data/,
    );
    const state = readBudget(path);
    // Never settled as succeeded-at-zero: the estimate stays reserved, so
    // remaining is under-stated, never over-stated.
    expect(state.settledActualMicrocents).toBe(0);
    expect(state.unresolvedReservationMicrocents).toBeGreaterThan(0);
  });

  test("the per-brief cap survives a retry with a fresh client", async () => {
    const path = budgetPath();
    initializeBudget(path, { capMicrocents: 1_500_000_000, note: "test" });
    // Cap = one estimate plus a margin smaller than the settled actual
    // (1000 in + 100 out tokens = 450,000 microcents): the first call fits,
    // and a brand-new client for the retry must see the first call's durable
    // spend and refuse — the cap cannot restart from zero.
    const estimate = estimateRequestCostMicrocents(
      "sonnet",
      extractionInput().request,
    );
    const cap = estimate + 200_000;
    const first = createBudgetedModelClient(
      innerClient({ usage }),
      scope(path, cap),
    );
    await first.extractFromIdea(extractionInput());

    const second = createBudgetedModelClient(
      innerClient({ usage }),
      scope(path, cap),
    );
    await expect(second.extractFromIdea(extractionInput())).rejects.toThrow(
      PerBriefCapError,
    );
    await expect(second.extractFromIdea(extractionInput())).rejects.toThrow(
      /already committed/,
    );
  });
});
