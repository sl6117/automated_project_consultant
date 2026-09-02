import { describe, expect, test } from "vitest";
import { openTestLedger } from "../helpers/test-db";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import { runModelAttempt } from "../../../src/server/model/attempt-runner";
import { createLiveModelClient } from "../../../src/server/model/live-client";
import { describeExtractionRequest } from "../../../src/server/model/prompt";
import {
  buildDiagnostics,
  describeStructuredOutputFailure,
} from "../../../src/server/model/response-diagnostics";
import { createLiveJudgeClient } from "../../../src/eval/live-judge-client";
import { briefSchema, labelsSchema } from "../../../src/eval/corpus-schemas";
import { judgeTranscript } from "../../../src/eval/judge-run";
import type { ReplayTranscript } from "../../../src/eval/replay";

// A billed response can fail validation for distinguishable reasons —
// truncation at max_tokens, a plain-text refusal, a JSON-string root, or
// malformed JSON. These tests pin that the live clients preserve
// stop_reason, that validation errors state the cause, and that spend still
// settles at actual cost before the failure propagates.

const sdkUsage = { input_tokens: 900, output_tokens: 120 };

function fakeSdk(response: {
  text: string;
  stop_reason?: string;
}) {
  return {
    messages: {
      async create() {
        return {
          content: [{ type: "text", text: response.text }],
          stop_reason: response.stop_reason ?? "end_turn",
          usage: sdkUsage,
        };
      },
    },
  };
}

describe("failure classification", () => {
  test("max_tokens truncation names the ceiling", () => {
    const message = describeStructuredOutputFailure(
      buildDiagnostics('{"statements": [', "max_tokens", false, null),
    );
    expect(message).toContain("max_tokens");
    expect(message).toContain("incomplete");
  });

  test("a refusal names the refusal", () => {
    const message = describeStructuredOutputFailure(
      buildDiagnostics("I can't help with that.", "refusal", false, null),
    );
    expect(message).toContain("refused");
  });

  test("a JSON-string root is distinguished from malformed JSON", () => {
    expect(
      describeStructuredOutputFailure(
        buildDiagnostics(
          '"just a quoted string"',
          "end_turn",
          true,
          "just a quoted string",
        ),
      ),
    ).toContain("string root");
    expect(
      describeStructuredOutputFailure(
        buildDiagnostics("not json at all", "end_turn", false, null),
      ),
    ).toContain("not valid JSON");
  });

  test("diagnostics carry no response content — only metadata", () => {
    const secret = "the persona's private answer text";
    const diagnostics = buildDiagnostics(secret, "refusal", false, null);
    const message = describeStructuredOutputFailure(diagnostics);
    expect(JSON.stringify(diagnostics)).not.toContain("persona");
    expect(message).not.toContain("persona");
    expect(diagnostics.textLength).toBe(secret.length);
    expect(diagnostics.jsonRootType).toBeNull();
  });

  test("the JSON root type is classified when parseable", () => {
    expect(
      buildDiagnostics("[1]", "end_turn", true, [1]).jsonRootType,
    ).toBe("array");
    expect(
      buildDiagnostics("null", "end_turn", true, null).jsonRootType,
    ).toBe("null");
    expect(
      buildDiagnostics("{}", "end_turn", true, {}).jsonRootType,
    ).toBe("object");
  });
});

describe("live client diagnostics", () => {
  const request = describeExtractionRequest({ idea: "i", projectName: "P" });

  test("valid structured output parses with diagnostics attached", async () => {
    const client = createLiveModelClient({
      sdk: fakeSdk({ text: '{"statements": [], "concerns": []}' }),
    });
    const result = await client.extractFromIdea({
      idea: "i",
      projectName: "P",
      request,
    });
    expect(result.payload).toEqual({ statements: [], concerns: [] });
    expect(result.diagnostics?.parsedAsJson).toBe(true);
    expect(result.diagnostics?.stopReason).toBe("end_turn");
  });

  test("truncated output preserves stop_reason max_tokens", async () => {
    const client = createLiveModelClient({
      sdk: fakeSdk({ text: '{"statements": [', stop_reason: "max_tokens" }),
    });
    const result = await client.extractFromIdea({
      idea: "i",
      projectName: "P",
      request,
    });
    expect(typeof result.payload).toBe("string");
    expect(result.diagnostics?.stopReason).toBe("max_tokens");
    expect(result.diagnostics?.parsedAsJson).toBe(false);
  });

  test("the live judge client attaches the same diagnostics", async () => {
    const client = createLiveJudgeClient({
      sdk: fakeSdk({ text: "I decline.", stop_reason: "refusal" }),
    });
    const result = await client.judge({
      task: "judge-sufficiency",
      request: {
        model: "m",
        max_tokens: 10,
        system: [],
        messages: [{ role: "user", content: "c" }],
        output_config: { format: { type: "json_schema", schema: {} } },
      },
    });
    expect(result.diagnostics?.stopReason).toBe("refusal");
    expect(result.usage?.inputTokens).toBe(900);
  });
});

describe("validation failures carry diagnostics and settle at actual cost", () => {
  test("attempt runner: error states the cause, attempt settles validation_failed with actuals", async () => {
    const db = openTestLedger();
    const project = createProject(db, "P", "i");
    const session = createSession(db, project.id);
    const request = describeExtractionRequest({ idea: "i", projectName: "P" });
    const client = createLiveModelClient({
      sdk: fakeSdk({ text: '{"statements": [', stop_reason: "max_tokens" }),
    });

    await expect(
      runModelAttempt({
        db,
        sessionId: session.id,
        alias: "sonnet",
        executionProvenance: "live",
        request,
        invoke: () =>
          client.extractFromIdea({ idea: "i", projectName: "P", request }),
        parse: () => {
          throw new Error("Expected object, received string");
        },
      }),
    ).rejects.toThrow(/max_tokens/);

    const attempt = db
      .prepare("SELECT status, actual_cost_microcents FROM model_calls WHERE session_id = ?")
      .get(session.id) as { status: string; actual_cost_microcents: number };
    expect(attempt.status).toBe("validation_failed");
    expect(attempt.actual_cost_microcents).toBeGreaterThan(0);
  });

  test("judge runner: a refusal states the cause in the thrown error", async () => {
    const brief = briefSchema.parse({
      id: "diag-brief",
      projectName: "D",
      idea: "an idea",
      domain: "test",
      traits: [],
      maxTurns: 12,
      fallback: { disposition: "unknown" },
      answers: { problem: ["p"], user: ["u"], workflow: ["w"], success: ["s"] },
    });
    const labels = labelsSchema.parse({
      briefId: "diag-brief",
      status: "authored",
      requiredStatements: [],
      forbiddenContent: [],
      requiredConcerns: ["problem"],
      expectedTensions: [],
      stopTurn: null,
      questionRankings: [],
    });
    const transcript: ReplayTranscript = {
      briefId: "diag-brief",
      outcome: "stopped",
      turns: [],
      stopOfferedAtTurn: 1,
      coreCoveredAtTurn: 0,
      framedAt: null,
      approvedStatements: [{ kind: "fact", body: "A statement." }],
      approvedConcernCodes: [],
      tensionsRaisedTotal: 0,
      artifacts: [],
      attemptOutcomes: [],
      failureDetail: null,
    };
    const client = createLiveJudgeClient({
      sdk: fakeSdk({ text: "I decline to judge this.", stop_reason: "refusal" }),
    });

    await expect(
      judgeTranscript({ brief, transcript, labels, client }),
    ).rejects.toThrow(/refused/);
  });
});
