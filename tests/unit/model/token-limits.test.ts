import { describe, expect, test } from "vitest";
import { estimateRequestCostMicrocents } from "../../../src/server/model/pricing";
import {
  describeCoachRequest,
  describeExtractionRequest,
  describeIncrementalExtractionRequest,
  describeNextQuestionRequest,
  MAX_OUTPUT_TOKENS,
  NEXT_QUESTION_MAX_OUTPUT_TOKENS,
} from "../../../src/server/model/prompt";

// Next-question responses truncated at the shared 1,500-token ceiling
// (stop_reason=max_tokens, evidenced live 2026-09-01), so that one task
// carries its own higher limit. These tests pin the per-task limits and that
// the cost estimate derives from each request's own max_tokens — the
// reservation bound must grow with the ceiling, not lag it.

const approved = { statements: [], concerns: [] };
const context = {
  missingCoreCodes: [],
  openContradictions: [],
  resolvedQuestions: [],
};

describe("per-task output token limits", () => {
  test("next-question carries the raised limit; the other tasks keep the shared one", () => {
    expect(NEXT_QUESTION_MAX_OUTPUT_TOKENS).toBe(3_000);
    expect(
      describeNextQuestionRequest({
        projectName: "P",
        idea: "i",
        approved,
        context,
      }).max_tokens,
    ).toBe(NEXT_QUESTION_MAX_OUTPUT_TOKENS);
    expect(
      describeExtractionRequest({ projectName: "P", idea: "i" }).max_tokens,
    ).toBe(MAX_OUTPUT_TOKENS);
    expect(
      describeIncrementalExtractionRequest({
        projectName: "P",
        idea: "i",
        approved,
        resolved: { questionBody: "q", answerBody: "a", disposition: "answered" },
      }).max_tokens,
    ).toBe(MAX_OUTPUT_TOKENS);
    expect(
      describeCoachRequest({
        projectName: "P",
        idea: "i",
        questionBody: "q",
        approvedStatements: [],
        approvedConcerns: [],
      }).max_tokens,
    ).toBe(MAX_OUTPUT_TOKENS);
  });

  test("the cost estimate derives from the request's own max_tokens", () => {
    const request = describeNextQuestionRequest({
      projectName: "P",
      idea: "i",
      approved,
      context,
    });
    const shrunk = { ...request, max_tokens: MAX_OUTPUT_TOKENS };
    const raised = estimateRequestCostMicrocents("fable", request);
    const baseline = estimateRequestCostMicrocents("fable", shrunk);
    // Fable output price is 5,000 microcents/token; the 1,500-token raise
    // must grow the estimate by ~7.5M microcents (the serialized max_tokens
    // digits also shift the byte-length input bound by a few tokens).
    expect(raised - baseline).toBeGreaterThanOrEqual(1_500 * 5_000);
    expect(raised - baseline).toBeLessThan(1_500 * 5_000 + 10_000);
  });
});
