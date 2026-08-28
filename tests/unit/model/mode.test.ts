import { afterEach, describe, expect, test } from "vitest";
import { extractionOutputSchema } from "../../../src/server/ledger/schemas";
import { resolveModelClient } from "../../../src/server/model/mode";
import { parseAdaptiveNextQuestion } from "../../../src/server/model/next-question";
import {
  describeExtractionRequest,
  describeNextQuestionRequest,
} from "../../../src/server/model/prompt";
import { emptyAdaptiveContext } from "../helpers/adaptive-context";

const savedMode = process.env.CONSULTANT_MODEL_MODE;
const savedKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (savedMode === undefined) {
    delete process.env.CONSULTANT_MODEL_MODE;
  } else {
    process.env.CONSULTANT_MODEL_MODE = savedMode;
  }
  if (savedKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = savedKey;
  }
});

describe("resolveModelClient", () => {
  test("defaults to the stub client when the env var is unset", async () => {
    delete process.env.CONSULTANT_MODEL_MODE;
    const client = resolveModelClient();

    const result = await client.nextQuestion({
      idea: "an idea",
      projectName: "Zed",
      request: describeNextQuestionRequest({
        idea: "an idea",
        projectName: "Zed",
        approved: { statements: [], concerns: [] },
        context: emptyAdaptiveContext(),
      }),
    });
    const payload = parseAdaptiveNextQuestion(result.payload, {
      approvedStatementIds: new Set(),
    });
    expect(payload.candidates[0]?.body).toContain("Zed");
    expect(result.usage).toBeNull();
    expect(client.executionProvenance).toBe("synthetic");
  });

  test("recorded mode returns the fixture-backed client", async () => {
    const client = resolveModelClient("recorded");

    const result = await client.extractFromIdea({
      idea: "ignored",
      projectName: "ignored",
      request: describeExtractionRequest({
        idea: "ignored",
        projectName: "ignored",
      }),
    });
    const extraction = extractionOutputSchema.parse(result.payload);
    expect(extraction.statements.length).toBeGreaterThan(0);
    expect(
      extraction.statements.some((statement) =>
        statement.body.includes("household"),
      ),
    ).toBe(true);
    expect(client.executionProvenance).toBe("recorded");
  });

  test("live mode without an API key is refused", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => resolveModelClient("live")).toThrow(/ANTHROPIC_API_KEY/);
  });

  test("live mode with a key resolves a live client without any network call", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-never-used";
    const client = resolveModelClient("live");
    expect(client.executionProvenance).toBe("live");
  });

  test("rejects an unsupported mode", () => {
    expect(() => resolveModelClient("cached")).toThrow(
      /Unsupported CONSULTANT_MODEL_MODE/,
    );
  });

  test("reads the mode from the environment", () => {
    process.env.CONSULTANT_MODEL_MODE = "bogus";
    expect(() => resolveModelClient()).toThrow(
      /Unsupported CONSULTANT_MODEL_MODE/,
    );
  });
});
