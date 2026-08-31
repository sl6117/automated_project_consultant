import { describe, expect, test } from "vitest";
import {
  calibrationLabelsSchema,
  CalibrationError,
  computeAgreement,
  JUDGE_TRUST_THRESHOLDS,
  type JudgeBriefScores,
  type JudgeTrustThresholds,
} from "../../../src/eval/calibration";

function judgeScores(
  overrides: Partial<JudgeBriefScores> = {},
): JudgeBriefScores {
  return {
    briefId: "b",
    inventedStatementIndexes: [1],
    statementCount: 4,
    usefulnessByTurn: [
      { turn: 1, score: 4, why: "w" },
      { turn: 2, score: 2, why: "w" },
    ],
    minimumSufficiency: { score: 4, why: "w" },
    ...overrides,
  };
}

function ownerLabels(overrides: Record<string, unknown> = {}) {
  return calibrationLabelsSchema.parse({
    briefId: "b",
    runId: "run-one",
    status: "authored",
    inventedStatementIndexes: [1],
    usefulnessByTurn: [
      { turn: 1, score: 4 },
      { turn: 2, score: 3 },
    ],
    minimumSufficiency: 4,
    ...overrides,
  });
}

// Small-sample thresholds so trust logic is testable on compact fixtures;
// the defaults' minimums get their own tests below.
const tiny: JudgeTrustThresholds = {
  ...JUDGE_TRUST_THRESHOLDS,
  minFaithfulnessSamples: 1,
  minUsefulnessSamples: 1,
  minSufficiencySamples: 1,
};

describe("judge calibration agreement", () => {
  test("perfect agreement with an invented positive is trusted (small-sample thresholds)", () => {
    const [faithfulness] = computeAgreement(
      [{ judge: judgeScores(), owner: ownerLabels() }],
      tiny,
    );
    expect(faithfulness!.exact).toBe(1);
    expect(faithfulness!.samples).toBe(4);
    expect(faithfulness!.trusted).toBe(true);
    expect(faithfulness!.untrustedReason).toBeNull();
  });

  test("verdict-level disagreement counts per statement, both directions", () => {
    // Judge flags 1; owner flags 2: indexes 1 and 2 disagree, 0 and 3 agree.
    const [faithfulness] = computeAgreement(
      [
        {
          judge: judgeScores({ inventedStatementIndexes: [1] }),
          owner: ownerLabels({ inventedStatementIndexes: [2] }),
        },
      ],
      tiny,
    );
    expect(faithfulness!.exact).toBe(0.5);
    expect(faithfulness!.trusted).toBe(false);
  });

  test("usefulness grades on within-one; exact reported beside it", () => {
    const [, usefulness] = computeAgreement(
      [{ judge: judgeScores(), owner: ownerLabels() }],
      tiny,
    );
    // Turn 1: 4 vs 4 exact. Turn 2: 2 vs 3 within one.
    expect(usefulness!.exact).toBe(0.5);
    expect(usefulness!.withinOne).toBe(1);
    expect(usefulness!.samples).toBe(2);
    expect(usefulness!.trusted).toBe(true);
  });

  test("a wide usefulness gap breaks trust at the configured threshold", () => {
    const [, usefulness] = computeAgreement(
      [
        {
          judge: judgeScores({
            usefulnessByTurn: [
              { turn: 1, score: 5, why: "w" },
              { turn: 2, score: 5, why: "w" },
            ],
          }),
          owner: ownerLabels({
            usefulnessByTurn: [
              { turn: 1, score: 1 },
              { turn: 2, score: 2 },
            ],
          }),
        },
      ],
      tiny,
    );
    expect(usefulness!.withinOne).toBe(0);
    expect(usefulness!.trusted).toBe(false);
    expect(usefulness!.untrustedReason).toContain("threshold");
  });

  test("default thresholds refuse trust below the minimum sample counts", () => {
    // One brief: 4 faithfulness samples < 20, 2 usefulness < 10, 1
    // sufficiency < 8 — perfect agreement is not enough.
    const agreements = computeAgreement([
      { judge: judgeScores(), owner: ownerLabels() },
    ]);
    for (const agreement of agreements) {
      expect(agreement.trusted).toBe(false);
      expect(agreement.untrustedReason).toContain("fewer than the");
    }
  });

  test("the 19/20 loophole: missing the only invented positive is untrusted despite 95% agreement", () => {
    // 20 statements, owner flags index 7 invented, judge flags nothing:
    // exact agreement 19/20 = 0.95 clears the 0.9 threshold, the sample
    // minimum is met, and one positive exists — but invention recall is 0,
    // so the dimension must NOT be trusted.
    const [faithfulness] = computeAgreement([
      {
        judge: judgeScores({
          statementCount: 20,
          inventedStatementIndexes: [],
        }),
        owner: ownerLabels({ inventedStatementIndexes: [7] }),
      },
    ]);
    expect(faithfulness!.exact).toBe(0.95);
    expect(faithfulness!.samples).toBe(20);
    expect(faithfulness!.inventedRecall).toBe(0);
    expect(faithfulness!.trusted).toBe(false);
    expect(faithfulness!.untrustedReason).toContain("invention recall 0.00");
  });

  test("full recall on the labeled positives at scale is trusted under the defaults", () => {
    const [faithfulness] = computeAgreement([
      {
        judge: judgeScores({
          statementCount: 20,
          inventedStatementIndexes: [3, 7],
        }),
        owner: ownerLabels({ inventedStatementIndexes: [3, 7] }),
      },
    ]);
    expect(faithfulness!.exact).toBe(1);
    expect(faithfulness!.inventedRecall).toBe(1);
    expect(faithfulness!.trusted).toBe(true);
  });

  test("partial recall across briefs is aggregated and still refused", () => {
    // Two briefs, one positive each; the judge catches only the first:
    // recall 0.5 < 1.0.
    const [faithfulness] = computeAgreement([
      {
        judge: judgeScores({
          statementCount: 10,
          inventedStatementIndexes: [2],
        }),
        owner: ownerLabels({ inventedStatementIndexes: [2] }),
      },
      {
        judge: judgeScores({
          statementCount: 10,
          inventedStatementIndexes: [],
        }),
        owner: ownerLabels({ inventedStatementIndexes: [4] }),
      },
    ]);
    expect(faithfulness!.inventedRecall).toBe(0.5);
    expect(faithfulness!.trusted).toBe(false);
    expect(faithfulness!.untrustedReason).toContain("1 of 2");
  });

  test("faithfulness is never trusted without an owner-labeled invented positive", () => {
    const [faithfulness] = computeAgreement(
      [
        {
          judge: judgeScores({ inventedStatementIndexes: [] }),
          owner: ownerLabels({ inventedStatementIndexes: [] }),
        },
      ],
      tiny,
    );
    expect(faithfulness!.exact).toBe(1);
    expect(faithfulness!.trusted).toBe(false);
    expect(faithfulness!.untrustedReason).toContain("invented");
  });

  test("an owner-scored turn the judge never scored fails loudly, never skipped", () => {
    expect(() =>
      computeAgreement(
        [
          {
            judge: judgeScores({
              usefulnessByTurn: [{ turn: 1, score: 4, why: "w" }],
            }),
            owner: ownerLabels(),
          },
        ],
        tiny,
      ),
    ).toThrow(/no score for it/);
  });

  test("duplicate judge turns are refused", () => {
    expect(() =>
      computeAgreement(
        [
          {
            judge: judgeScores({
              usefulnessByTurn: [
                { turn: 1, score: 4, why: "w" },
                { turn: 1, score: 5, why: "w" },
                { turn: 2, score: 2, why: "w" },
              ],
            }),
            owner: ownerLabels(),
          },
        ],
        tiny,
      ),
    ).toThrow(/duplicate turn/);
  });

  test("an owner invented index beyond the statement count is refused", () => {
    expect(() =>
      computeAgreement(
        [
          {
            judge: judgeScores(),
            owner: ownerLabels({ inventedStatementIndexes: [9] }),
          },
        ],
        tiny,
      ),
    ).toThrow(/only 4 statements/);
  });

  test("the labels schema refuses duplicate turns and duplicate indexes", () => {
    expect(() =>
      ownerLabels({
        usefulnessByTurn: [
          { turn: 1, score: 4 },
          { turn: 1, score: 5 },
        ],
      }),
    ).toThrow(/Duplicate usefulness/);
    expect(() =>
      ownerLabels({ inventedStatementIndexes: [1, 1] }),
    ).toThrow(/Duplicate invented/);
  });

  test("zero samples is never trusted", () => {
    const [faithfulness] = computeAgreement(
      [
        {
          judge: judgeScores({
            statementCount: 0,
            inventedStatementIndexes: [],
            usefulnessByTurn: [],
          }),
          owner: ownerLabels({
            inventedStatementIndexes: [],
            usefulnessByTurn: [],
          }),
        },
      ],
      tiny,
    );
    expect(faithfulness!.samples).toBe(0);
    expect(faithfulness!.trusted).toBe(false);
  });

  test("template calibration labels are refused", () => {
    expect(() =>
      computeAgreement(
        [
          {
            judge: judgeScores(),
            owner: ownerLabels({
              status: "template",
              usefulnessByTurn: [],
              inventedStatementIndexes: [],
            }),
          },
        ],
        tiny,
      ),
    ).toThrow(CalibrationError);
  });

  test("a brief-id mismatch between judge and owner is refused", () => {
    expect(() =>
      computeAgreement(
        [{ judge: judgeScores({ briefId: "other" }), owner: ownerLabels() }],
        tiny,
      ),
    ).toThrow(/mismatch/);
  });
});
