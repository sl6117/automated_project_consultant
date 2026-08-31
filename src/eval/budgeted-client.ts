import type { ModelClient, ModelClientResult } from "../server/model/client";
import type { ModelAlias } from "../server/model/config";
import {
  costOfUsageMicrocents,
  estimateRequestCostMicrocents,
} from "../server/model/pricing";
import type { ModelRequestDescription } from "../server/model/prompt";
import {
  briefCommittedMicrocents,
  BudgetExceededError,
  readBudget,
  reserveSpend,
  settleSpend,
} from "./budget";
import type { JudgeClient } from "./judge-client";

// Wraps live clients so every call runs the two-phase budget contract: a
// durably flushed reservation precedes the request, a settlement follows it.
// The reservation itself refuses when the estimate no longer fits the
// remaining phase budget. A per-brief cap is enforced here too: the wrapper
// tracks this brief's reserved-plus-settled total and refuses a call that
// would push past it (the spec routes this through session caps; enforcing
// it at the budget boundary is strictly stronger and also covers judge
// calls, which have no session).

export class PerBriefCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PerBriefCapError";
  }
}

type BudgetScope = {
  budgetPath: string;
  runId: string;
  briefId: string;
  perBriefCapMicrocents: number;
};

function createSpendGuard(scope: BudgetScope, role: "consultant" | "judge") {
  return async function guarded(
    alias: ModelAlias,
    estimateMicrocents: number,
    invoke: () => Promise<ModelClientResult>,
  ): Promise<ModelClientResult> {
    // The per-brief committed total comes from the durable record, never an
    // in-memory counter: a retried brief carries its earlier attempts' spend
    // against the same cap instead of restarting from zero.
    const committed = briefCommittedMicrocents(
      readBudget(scope.budgetPath),
      scope.runId,
      scope.briefId,
      role,
    );
    if (committed + estimateMicrocents > scope.perBriefCapMicrocents) {
      throw new PerBriefCapError(
        `Brief ${scope.briefId}: ${committed} microcents already committed; reserving ${estimateMicrocents} more would exceed the per-brief ${role} cap of ${scope.perBriefCapMicrocents}`,
      );
    }
    const reservationId = reserveSpend(scope.budgetPath, {
      runId: scope.runId,
      briefId: scope.briefId,
      role,
      estimateMicrocents,
    });
    let result: ModelClientResult;
    try {
      result = await invoke();
    } catch (error) {
      settleSpend(scope.budgetPath, {
        reservationId,
        outcome: "transport_failed",
      });
      throw error;
    }
    if (!result.usage) {
      // A resolved call with no usage data has unknown real spend. Settling
      // it as succeeded at zero would overstate the remaining budget, so it
      // fails closed exactly like a transport fault: the reservation stays
      // at its estimate and the brief attempt fails.
      settleSpend(scope.budgetPath, {
        reservationId,
        outcome: "transport_failed",
      });
      throw new Error(
        `Brief ${scope.briefId}: ${role} call resolved without usage data; spend unknown, reservation kept at its estimate`,
      );
    }
    settleSpend(scope.budgetPath, {
      reservationId,
      outcome: "succeeded",
      actualMicrocents: costOfUsageMicrocents(alias, result.usage),
    });
    return result;
  };
}

export function createBudgetedModelClient(
  inner: ModelClient,
  scope: BudgetScope,
): ModelClient {
  const guarded = createSpendGuard(scope, "consultant");

  function run(
    alias: ModelAlias,
    request: ModelRequestDescription,
    invoke: () => Promise<ModelClientResult>,
  ): Promise<ModelClientResult> {
    return guarded(alias, estimateRequestCostMicrocents(alias, request), invoke);
  }

  return {
    executionProvenance: inner.executionProvenance,
    extractFromIdea(input) {
      return run("sonnet", input.request, () => inner.extractFromIdea(input));
    },
    incrementalExtraction(input) {
      return run("sonnet", input.request, () =>
        inner.incrementalExtraction(input),
      );
    },
    nextQuestion(input) {
      return run("fable", input.request, () => inner.nextQuestion(input));
    },
    coachRecommendation(input) {
      return run("fable", input.request, () =>
        inner.coachRecommendation(input),
      );
    },
  };
}

export function createBudgetedJudgeClient(
  inner: JudgeClient,
  scope: BudgetScope,
): JudgeClient {
  const guarded = createSpendGuard(scope, "judge");
  return {
    executionProvenance: inner.executionProvenance,
    judge(input) {
      // Judge requests are plain serializable descriptions; the byte-length
      // bound applies to them the same way it does to consultant requests.
      const estimate = estimateRequestCostMicrocents(
        "sonnet",
        input.request as unknown as ModelRequestDescription,
      );
      return guarded("sonnet", estimate, () => inner.judge(input));
    },
  };
}

export { BudgetExceededError };
