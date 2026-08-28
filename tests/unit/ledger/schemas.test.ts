import { describe, expect, test } from "vitest";
import {
  adaptiveNextQuestionOutputSchema,
  extractionOutputSchema,
  incrementalExtractionOutputSchema,
  proposeStatementSchema,
  resolveQuestionSchema,
} from "../../../src/server/ledger/schemas";

function validCandidate() {
  return {
    body: "Who captures incoming household tasks today?",
    whySelected: "The operator is unnamed.",
    concernCodes: ["workflow"],
    claimedScores: { coreGap: 3, sliceBounding: 2, contradictionResolution: 0 },
    targetsContradictionIndexes: [],
  };
}

function validAdaptivePayload(): {
  candidates: ReturnType<typeof validCandidate>[];
  contradictions: { summary: string; citedStatementIds: string[] }[];
  readyAdvice: { ready: boolean; why: string };
} {
  return {
    candidates: [validCandidate()],
    contradictions: [],
    readyAdvice: { ready: false, why: "Core coverage is missing." },
  };
}

describe("extraction schemas are strict at every level", () => {
  const statement = { kind: "fact", body: "A fact." };
  const concern = { code: "user", coverage: "An operator exists." };

  test("both accept their clean shapes", () => {
    expect(
      extractionOutputSchema.safeParse({
        statements: [statement],
        concerns: [concern],
      }).success,
    ).toBe(true);
    expect(
      incrementalExtractionOutputSchema.safeParse({
        statements: [],
        concerns: [],
      }).success,
    ).toBe(true);
  });

  test("an unknown top-level field is rejected, not silently dropped", () => {
    const padded = {
      statements: [statement],
      concerns: [],
      confidence: "high",
    };
    expect(extractionOutputSchema.safeParse(padded).success).toBe(false);
    expect(incrementalExtractionOutputSchema.safeParse(padded).success).toBe(
      false,
    );
  });

  test("an unknown item-level field is rejected in both schemas", () => {
    const paddedStatement = {
      statements: [{ ...statement, rationale: "hallucinated" }],
      concerns: [],
    };
    const paddedConcern = {
      statements: [statement],
      concerns: [{ ...concern, priority: 1 }],
    };
    expect(extractionOutputSchema.safeParse(paddedStatement).success).toBe(
      false,
    );
    expect(
      incrementalExtractionOutputSchema.safeParse(paddedConcern).success,
    ).toBe(false);
  });
});

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

describe("adaptiveNextQuestionOutputSchema", () => {
  test("accepts a valid adaptive payload", () => {
    expect(
      adaptiveNextQuestionOutputSchema.safeParse(validAdaptivePayload())
        .success,
    ).toBe(true);
  });

  test("rejects an empty candidate body", () => {
    const payload = validAdaptivePayload();
    payload.candidates[0]!.body = "";
    expect(adaptiveNextQuestionOutputSchema.safeParse(payload).success).toBe(
      false,
    );
  });

  test("rejects more than five candidates and zero candidates", () => {
    const six = validAdaptivePayload();
    six.candidates = Array.from({ length: 6 }, () => validCandidate());
    expect(adaptiveNextQuestionOutputSchema.safeParse(six).success).toBe(false);

    const none = validAdaptivePayload();
    none.candidates = [];
    expect(adaptiveNextQuestionOutputSchema.safeParse(none).success).toBe(
      false,
    );
  });

  test("rejects out-of-range claimed scores and empty concern codes", () => {
    const badScore = validAdaptivePayload();
    badScore.candidates[0]!.claimedScores.coreGap = 4;
    expect(adaptiveNextQuestionOutputSchema.safeParse(badScore).success).toBe(
      false,
    );

    const noCodes = validAdaptivePayload();
    noCodes.candidates[0]!.concernCodes = [];
    expect(adaptiveNextQuestionOutputSchema.safeParse(noCodes).success).toBe(
      false,
    );
  });

  test("rejects a contradiction citing fewer than two statements", () => {
    const payload = validAdaptivePayload();
    payload.contradictions = [
      { summary: "A tension", citedStatementIds: ["only-one"] },
    ];
    expect(adaptiveNextQuestionOutputSchema.safeParse(payload).success).toBe(
      false,
    );
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
