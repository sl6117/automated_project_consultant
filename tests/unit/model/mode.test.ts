import { afterEach, describe, expect, test } from "vitest";
import {
  extractionOutputSchema,
  nextQuestionOutputSchema,
} from "../../../src/server/ledger/schemas";
import { resolveModelClient } from "../../../src/server/model/mode";

const savedMode = process.env.CONSULTANT_MODEL_MODE;

afterEach(() => {
  if (savedMode === undefined) {
    delete process.env.CONSULTANT_MODEL_MODE;
  } else {
    process.env.CONSULTANT_MODEL_MODE = savedMode;
  }
});

describe("resolveModelClient", () => {
  test("defaults to the stub client when the env var is unset", () => {
    delete process.env.CONSULTANT_MODEL_MODE;
    const client = resolveModelClient();

    const question = nextQuestionOutputSchema.parse(
      client.nextQuestion({ idea: "an idea", projectName: "Zed" }),
    );
    expect(question.body).toContain("Zed");
    expect(client.executionProvenance).toBe("synthetic");
  });

  test("recorded mode returns the fixture-backed client", () => {
    const client = resolveModelClient("recorded");

    const extraction = extractionOutputSchema.parse(
      client.extractFromIdea({ idea: "ignored", projectName: "ignored" }),
    );
    expect(extraction.statements.length).toBeGreaterThan(0);
    expect(
      extraction.statements.some((statement) =>
        statement.body.includes("household"),
      ),
    ).toBe(true);
    expect(client.executionProvenance).toBe("recorded");
  });

  test("rejects an unsupported mode", () => {
    expect(() => resolveModelClient("live")).toThrow(
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
