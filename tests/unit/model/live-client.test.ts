import { describe, expect, test } from "vitest";
import {
  createLiveModelClient,
  type MessagesSdk,
} from "../../../src/server/model/live-client";
import {
  describeCoachRequest,
  describeExtractionRequest,
  describeNextQuestionRequest,
} from "../../../src/server/model/prompt";
import { emptyAdaptiveContext } from "../helpers/adaptive-context";

// A synthetic SDK response object; no test in this file touches the network.
function fakeSdk(response: unknown, capture?: { params?: unknown }): MessagesSdk {
  return {
    messages: {
      async create(params) {
        if (capture) {
          capture.params = params;
        }
        return response;
      },
    },
  };
}

describe("createLiveModelClient", () => {
  test("refuses to construct without a key or injected SDK", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => createLiveModelClient()).toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (saved !== undefined) {
        process.env.ANTHROPIC_API_KEY = saved;
      }
    }
  });

  test("sends the exact request description object and maps usage with cache tiers", async () => {
    const capture: { params?: unknown } = {};
    const client = createLiveModelClient({
      sdk: fakeSdk(
        {
          content: [{ type: "text", text: '{"body":"Q?","whySelected":"why"}' }],
          usage: {
            input_tokens: 900,
            output_tokens: 120,
            cache_read_input_tokens: 700,
            cache_creation: {
              ephemeral_5m_input_tokens: 40,
              ephemeral_1h_input_tokens: 10,
            },
          },
        },
        capture,
      ),
    });

    const request = describeNextQuestionRequest({
      idea: "an idea",
      projectName: "P",
      approved: {
        statements: [{ id: "st-1", body: "an approved body" }],
        concerns: [],
      },
      context: emptyAdaptiveContext(),
    });
    const result = await client.nextQuestion({
      idea: "an idea",
      projectName: "P",
      request,
    });

    expect(result.payload).toStrictEqual({ body: "Q?", whySelected: "why" });
    // (The fake response is a bare object; envelope validation happens at the
    // Zod boundary, not in the client.)
    expect(result.usage).toStrictEqual({
      inputTokens: 900,
      outputTokens: 120,
      cacheReadTokens: 700,
      cacheWrite5mTokens: 40,
      cacheWrite1hTokens: 10,
    });
    expect(client.executionProvenance).toBe("live");

    // The SDK receives the SAME object the estimate was computed from — not
    // a rebuilt copy.
    expect(capture.params).toBe(request);
    expect(request.model).toBe("claude-fable-5");
    expect(
      request.system.some((block) => block.cache_control !== undefined),
    ).toBe(true);
    expect(request.messages[0]?.content).toContain("an idea");
    expect(request.output_config.format.type).toBe("json_schema");
  });

  test("coaching sends approved ledger context inside the same description", async () => {
    const capture: { params?: unknown } = {};
    const client = createLiveModelClient({
      sdk: fakeSdk(
        {
          content: [{ type: "text", text: "{}" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        capture,
      ),
    });

    const request = describeCoachRequest({
      idea: "an idea",
      projectName: "P",
      questionBody: "Q?",
      approvedStatements: ["APPROVED-STATEMENT-MARKER"],
      approvedConcerns: ["problem: APPROVED-CONCERN-MARKER"],
    });
    await client.coachRecommendation({
      idea: "an idea",
      projectName: "P",
      questionBody: "Q?",
      approvedStatements: ["APPROVED-STATEMENT-MARKER"],
      approvedConcerns: ["problem: APPROVED-CONCERN-MARKER"],
      request,
    });

    expect(capture.params).toBe(request);
    expect(request.messages[0]?.content).toContain("APPROVED-STATEMENT-MARKER");
    expect(request.messages[0]?.content).toContain("APPROVED-CONCERN-MARKER");
    // The shared Fable envelope format still carries the strict coach branch.
    expect(request.output_config.format.schema.required).toStrictEqual([
      "task",
      "payload",
    ]);
    expect(JSON.stringify(request.output_config)).toContain(
      "evidenceWouldChange",
    );
  });

  test("legacy combined cache_creation_input_tokens count as 5-minute writes", async () => {
    const client = createLiveModelClient({
      sdk: fakeSdk({
        content: [{ type: "text", text: "{}" }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 33,
        },
      }),
    });

    const result = await client.extractFromIdea({
      idea: "x",
      projectName: "y",
      request: describeExtractionRequest({ idea: "x", projectName: "y" }),
    });
    expect(result.usage?.cacheWrite5mTokens).toBe(33);
    expect(result.usage?.cacheWrite1hTokens).toBe(0);
  });

  test("unparseable text is returned as-is for the Zod boundary to reject", async () => {
    const client = createLiveModelClient({
      sdk: fakeSdk({
        content: [{ type: "text", text: "not json at all" }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    });

    const result = await client.coachRecommendation({
      idea: "x",
      projectName: "y",
      questionBody: "z",
      approvedStatements: [],
      approvedConcerns: [],
      request: describeCoachRequest({
        idea: "x",
        projectName: "y",
        questionBody: "z",
        approvedStatements: [],
        approvedConcerns: [],
      }),
    });
    expect(result.payload).toBe("not json at all");
  });

  test("SDK failures propagate for the attempt runner to settle as transport_failed", async () => {
    const client = createLiveModelClient({
      sdk: {
        messages: {
          async create() {
            throw new Error("connection reset");
          },
        },
      },
    });

    await expect(
      client.nextQuestion({
        idea: "x",
        projectName: "y",
        request: describeNextQuestionRequest({
          idea: "x",
          projectName: "y",
          approved: { statements: [], concerns: [] },
          context: emptyAdaptiveContext(),
        }),
      }),
    ).rejects.toThrow("connection reset");
  });
});
