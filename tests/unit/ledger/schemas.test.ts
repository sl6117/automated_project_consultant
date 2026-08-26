import { describe, expect, test } from "vitest";
import {
  nextQuestionOutputSchema,
  proposeStatementSchema,
  resolveQuestionSchema,
} from "../../../src/server/ledger/schemas";

describe("proposeStatementSchema", () => {
  test("accepts a valid proposal", () => {
    const parsed = proposeStatementSchema.safeParse({
      sessionId: "session-1",
      kind: "fact",
      body: "The product is localhost-only.",
      provenanceSource: "user",
    });

    expect(parsed.success).toBe(true);
  });

  test("rejects unknown statement kinds", () => {
    const parsed = proposeStatementSchema.safeParse({
      sessionId: "session-1",
      kind: "epic",
      body: "Nope",
      provenanceSource: "user",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("nextQuestionOutputSchema", () => {
  test("accepts a Fable question with a visible reason", () => {
    const parsed = nextQuestionOutputSchema.safeParse({
      body: "Who captures incoming household tasks today?",
      whySelected: "The operator is unnamed.",
    });

    expect(parsed.success).toBe(true);
  });

  test("rejects an empty question body", () => {
    const parsed = nextQuestionOutputSchema.safeParse({
      body: "",
      whySelected: "Still needs a reason.",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("resolveQuestionSchema", () => {
  test("requires a body when the disposition is answered", () => {
    const parsed = resolveQuestionSchema.safeParse({
      questionId: "q-1",
      disposition: "answered",
      body: "   ",
    });

    expect(parsed.success).toBe(false);
  });

  test("allows an empty body when marking unknown", () => {
    const parsed = resolveQuestionSchema.safeParse({
      questionId: "q-1",
      disposition: "unknown",
      body: "",
    });

    expect(parsed.success).toBe(true);
  });
});
