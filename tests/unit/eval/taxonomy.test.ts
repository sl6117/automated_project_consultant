import { describe, expect, test } from "vitest";
import type { BriefScore, DimensionResult } from "../../../src/eval/score";
import {
  briefTaxonomyCodes,
  taxonomyCounts,
  TAXONOMY_CODES,
} from "../../../src/eval/taxonomy";

function pass(): DimensionResult {
  return { pass: true, applicable: true, detail: "ok" };
}

function fail(detail: string): DimensionResult {
  return { pass: false, applicable: true, detail };
}

function score(
  dimensions: Partial<BriefScore["dimensions"]>,
  passOverall = false,
): BriefScore {
  return {
    briefId: "b",
    pass: passOverall,
    dimensions: {
      extractionCoverage: pass(),
      questionEfficiency: pass(),
      contradictionHandling: pass(),
      stopCorrectness: pass(),
      contractDiscipline: pass(),
      ...dimensions,
    },
  };
}

describe("error taxonomy", () => {
  test("a passing brief has no codes", () => {
    expect(briefTaxonomyCodes(score({}, true))).toEqual([]);
  });

  test("every scored failure carries its own code — co-occurring failures are not collapsed", () => {
    const codes = briefTaxonomyCodes(
      score({
        contradictionHandling: fail("0 raised vs 1 labeled"),
        stopCorrectness: fail("premature"),
      }),
    );
    expect(codes).toContain("missed-tension");
    expect(codes).toContain("premature-stop-offer");
    expect(codes).toHaveLength(2);
  });

  test("each failed dimension maps to exactly one code", () => {
    const codes = briefTaxonomyCodes(
      score({
        contractDiscipline: fail("validation failed"),
        extractionCoverage: fail('forbidden content "x" appears'),
        stopCorrectness: fail("missed stop"),
        contradictionHandling: fail("cites 1, fewer than two"),
        questionEfficiency: fail("miss"),
      }),
    );
    expect(codes).toEqual([
      "contract-violation",
      "invented-fact",
      "missed-stop",
      "wrong-citation",
      "redundant-question",
    ]);
  });

  test("extraction failures split invented-fact vs missed-core-gap by the detail", () => {
    expect(
      briefTaxonomyCodes(
        score({ extractionCoverage: fail('forbidden content "x" appears') }),
      ),
    ).toEqual(["invented-fact"]);
    expect(
      briefTaxonomyCodes(
        score({ extractionCoverage: fail("missing required fact") }),
      ),
    ).toEqual(["missed-core-gap"]);
  });

  test("stop failures split premature vs missed by the detail", () => {
    expect(
      briefTaxonomyCodes(score({ stopCorrectness: fail("premature") })),
    ).toEqual(["premature-stop-offer"]);
    expect(
      briefTaxonomyCodes(score({ stopCorrectness: fail("missed stop") })),
    ).toEqual(["missed-stop"]);
  });

  test("a trusted judged faithfulness finding is its own scored failure", () => {
    const codes = briefTaxonomyCodes(
      score({ stopCorrectness: fail("premature") }),
      { inventedStatementIndexes: [0], faithfulnessTrusted: true },
    );
    expect(codes).toEqual(["premature-stop-offer", "invented-fact"]);
  });

  test("untrusted judged findings are ignored", () => {
    const codes = briefTaxonomyCodes(
      score({ stopCorrectness: fail("premature") }),
      { inventedStatementIndexes: [0], faithfulnessTrusted: false },
    );
    expect(codes).toEqual(["premature-stop-offer"]);
  });

  test("a failed brief with no matching rule fails loudly", () => {
    const broken = score({});
    broken.pass = false;
    expect(() => briefTaxonomyCodes(broken)).toThrow(/no taxonomy rule/);
  });

  test("counts cover every seed code and sum per-failure codes", () => {
    const counts = taxonomyCounts([
      "missed-stop",
      "missed-stop",
      "invented-fact",
    ]);
    expect(counts["missed-stop"]).toBe(2);
    expect(counts["invented-fact"]).toBe(1);
    expect(Object.keys(counts)).toHaveLength(TAXONOMY_CODES.length);
  });
});
