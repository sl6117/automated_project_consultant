import { describe, expect, test } from "vitest";
import {
  costOfUsageMicrocents,
  estimateRequestCostMicrocents,
} from "../../../src/server/model/pricing";
import { assertNoOpenTransaction } from "../../../src/server/model/transaction-guard";
import {
  buildSystemPrefix,
  describeCoachRequest,
  describeExtractionRequest,
  describeNextQuestionRequest,
} from "../../../src/server/model/prompt";
import { openMemoryLedger } from "../../../src/server/db/open";

describe("costOfUsageMicrocents", () => {
  test("prices every usage component including both cache-write tiers", () => {
    // sonnet: in 300, out 1500, read 30, write5m 375, write1h 600.
    const cost = costOfUsageMicrocents("sonnet", {
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 2000,
      cacheWrite5mTokens: 400,
      cacheWrite1hTokens: 100,
    });
    expect(cost).toBe(
      1000 * 300 + 100 * 1500 + 2000 * 30 + 400 * 375 + 100 * 600,
    );
  });

  test("the 5-minute and 1-hour tiers price differently", () => {
    const only5m = costOfUsageMicrocents("fable", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 100,
      cacheWrite1hTokens: 0,
    });
    const only1h = costOfUsageMicrocents("fable", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 100,
    });
    expect(only1h).toBeGreaterThan(only5m);
  });
});

describe("estimateRequestCostMicrocents", () => {
  test("is deterministic and grows with input size", () => {
    const small = estimateRequestCostMicrocents(
      "fable",
      describeNextQuestionRequest({ idea: "a".repeat(100), projectName: "P" }),
    );
    const large = estimateRequestCostMicrocents(
      "fable",
      describeNextQuestionRequest({
        idea: "a".repeat(100_000),
        projectName: "P",
      }),
    );
    expect(
      estimateRequestCostMicrocents(
        "fable",
        describeNextQuestionRequest({ idea: "a".repeat(100), projectName: "P" }),
      ),
    ).toBe(small);
    expect(large).toBeGreaterThan(small);
    expect(Number.isInteger(small)).toBe(true);
  });

  test("bounds by UTF-8 bytes so non-ASCII input is not underestimated", () => {
    // Same character count; the emoji string is four bytes per character.
    const ascii = estimateRequestCostMicrocents(
      "fable",
      describeNextQuestionRequest({ idea: "a".repeat(200), projectName: "P" }),
    );
    const emoji = estimateRequestCostMicrocents(
      "fable",
      describeNextQuestionRequest({ idea: "🍜".repeat(200), projectName: "P" }),
    );
    expect(emoji).toBeGreaterThan(ascii);
  });

  test("both Fable tasks serialize an identical shared output_config", () => {
    const question = describeNextQuestionRequest({
      idea: "one household inbox",
      projectName: "P",
    });
    const coach = describeCoachRequest({
      idea: "one household inbox",
      projectName: "P",
      questionBody: "Q?",
      approvedStatements: [],
      approvedConcerns: [],
    });

    // Byte-identical output_config: a per-task schema would invalidate the
    // prompt cache on every task switch.
    expect(JSON.stringify(coach.output_config)).toBe(
      JSON.stringify(question.output_config),
    );
    expect(coach.output_config.format).toBe(question.output_config.format);
    // The extraction task keeps its own format.
    expect(
      JSON.stringify(
        describeExtractionRequest({ idea: "x", projectName: "P" })
          .output_config,
      ),
    ).not.toBe(JSON.stringify(question.output_config));
  });

  test("the estimate covers the full serialized description including the shared schema", () => {
    const request = describeNextQuestionRequest({
      idea: "one household inbox",
      projectName: "P",
    });
    // fable: input 1000, output 5000 microcents per token.
    const expected =
      Buffer.byteLength(JSON.stringify(request), "utf8") * 1000 +
      request.max_tokens * 5000;
    expect(estimateRequestCostMicrocents("fable", request)).toBe(expected);
    expect(JSON.stringify(request)).toContain("next_question");
    expect(JSON.stringify(request)).toContain("evidenceWouldChange");
  });

  test("task framing, labels, and output schema all affect the estimate", () => {
    const semantic = { idea: "one household inbox", projectName: "P" };
    // Different tasks share the identical semantic input but differ in
    // framing text and output schema — the serialized descriptions differ,
    // so the estimates must too.
    const extraction = estimateRequestCostMicrocents(
      "sonnet",
      describeExtractionRequest(semantic),
    );
    const question = estimateRequestCostMicrocents(
      "sonnet",
      describeNextQuestionRequest(semantic),
    );
    expect(extraction).not.toBe(question);

    // Added approved-context labels grow the coach request's estimate.
    const bareCoach = estimateRequestCostMicrocents(
      "fable",
      describeCoachRequest({
        ...semantic,
        questionBody: "Q?",
        approvedStatements: [],
        approvedConcerns: [],
      }),
    );
    const groundedCoach = estimateRequestCostMicrocents(
      "fable",
      describeCoachRequest({
        ...semantic,
        questionBody: "Q?",
        approvedStatements: ["An approved statement that adds bytes."],
        approvedConcerns: ["problem: an approved coverage claim."],
      }),
    );
    expect(groundedCoach).toBeGreaterThan(bareCoach);
  });
});

describe("buildSystemPrefix", () => {
  test("is byte-stable across calls with the cache breakpoint on the last block", () => {
    const first = buildSystemPrefix();
    const second = buildSystemPrefix();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first[first.length - 1]?.cache_control).toStrictEqual({
      type: "ephemeral",
    });
    // Nothing session-specific may appear in the prefix.
    const text = first.map((block) => block.text).join("\n");
    expect(text).toContain("Concern ontology");
    expect(text).not.toMatch(/spend so far/i);
  });

  test("clears the prompt-caching minimum cacheable length", () => {
    // Caching needs >= 1,024 tokens for Sonnet-class models. At roughly four
    // bytes per token, 6,000 bytes leaves comfortable margin above that.
    const bytes = Buffer.byteLength(
      buildSystemPrefix()
        .map((block) => block.text)
        .join("\n"),
      "utf8",
    );
    expect(bytes).toBeGreaterThanOrEqual(6_000);
  });
});

describe("assertNoOpenTransaction", () => {
  test("throws inside a transaction and passes outside one", () => {
    const db = openMemoryLedger();
    expect(() => assertNoOpenTransaction(db)).not.toThrow();

    const inside = db.transaction(() => {
      assertNoOpenTransaction(db);
    });
    expect(() => inside()).toThrow(/transaction is open/);
  });
});
