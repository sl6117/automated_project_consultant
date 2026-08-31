import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  collectDimensionPassRates,
  evaluateThresholds,
  renderReportMarkdown,
  writeReport,
  type EvalReport,
} from "../../../src/eval/report";
import {
  DEFAULT_THRESHOLDS,
  thresholdsSchema,
} from "../../../src/eval/thresholds";

function report(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    generatedAt: "2026-08-31T00:00:00Z",
    runId: "run-one",
    runGitCommit: "abc1234",
    briefs: [],
    dimensionPassRates: {
      extractionCoverage: { passed: 10, applicable: 12 },
      stopCorrectness: { passed: 11, applicable: 12 },
      contractDiscipline: { passed: 12, applicable: 12 },
    },
    taxonomyCounts: {},
    judgeAgreement: null,
    judgedScoreMeans: null,
    phaseSpend: null,
    notes: [],
    ...overrides,
  };
}

describe("threshold config strictness", () => {
  test("the defaults parse: complete dimension, code, and judged sets", () => {
    expect(thresholdsSchema.safeParse(DEFAULT_THRESHOLDS).success).toBe(true);
  });

  test("a missing dimension key is rejected — a typo cannot disable a threshold", () => {
    const config = structuredClone(DEFAULT_THRESHOLDS) as unknown as Record<      string,
      Record<string, unknown>
    >;
    delete config["minDimensionPassRate"]!["questionEfficiency"];
    expect(thresholdsSchema.safeParse(config).success).toBe(false);
  });

  test("an unknown dimension key is rejected", () => {
    const config = structuredClone(DEFAULT_THRESHOLDS) as unknown as Record<      string,
      Record<string, unknown>
    >;
    config["minDimensionPassRate"]!["extractoinCoverage"] = 0.8;
    expect(thresholdsSchema.safeParse(config).success).toBe(false);
  });

  test("a missing taxonomy code is rejected", () => {
    const config = structuredClone(DEFAULT_THRESHOLDS) as unknown as Record<      string,
      Record<string, unknown>
    >;
    delete config["maxCodeCounts"]!["missed-stop"];
    expect(thresholdsSchema.safeParse(config).success).toBe(false);
  });
});

describe("judged means in thresholds", () => {
  test("a trusted mean below its minimum breaches", () => {
    const { breaches } = evaluateThresholds({
      report: report({
        judgedScoreMeans: [
          {
            dimension: "usefulness",
            mean: 2.4,
            samples: 12,
            trusted: true,
          },
        ],
      }),
      thresholds: DEFAULT_THRESHOLDS,
      baseline: null,
    });
    expect(
      breaches.some(
        (breach) => breach.rule === "minJudgedScoreMean.usefulness",
      ),
    ).toBe(true);
  });

  test("an untrusted mean is visibly excluded, never evaluated", () => {
    const { breaches, notes } = evaluateThresholds({
      report: report({
        judgedScoreMeans: [
          {
            dimension: "usefulness",
            mean: 1.0,
            samples: 12,
            trusted: false,
          },
        ],
      }),
      thresholds: DEFAULT_THRESHOLDS,
      baseline: null,
    });
    expect(breaches).toEqual([]);
    expect(notes.join(" ")).toContain("EXCLUDED from thresholds");
  });
});

describe("report writing", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const spend = {
    capMicrocents: 1_500_000_000,
    settledActualMicrocents: 0,
    unresolvedReservationMicrocents: 0,
    remainingMicrocents: 1_500_000_000,
    consultantSettledMicrocents: 0,
    judgeSettledMicrocents: 0,
  };

  test("reports are append-only: an existing pair is never overwritten", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-reports-"));
    dirs.push(dir);
    writeReport(dir, "baseline", report({ phaseSpend: spend }), []);
    expect(() =>
      writeReport(dir, "baseline", report({ phaseSpend: spend }), []),
    ).toThrow(/append-only/);
  });

  test("a report without readable budget state is refused, not written", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-reports-"));
    dirs.push(dir);
    expect(() =>
      writeReport(dir, "baseline", report({ phaseSpend: null }), []),
    ).toThrow(/readable budget record/);
  });
});

describe("threshold evaluation", () => {
  test("no baseline: comparison skipped with a note, no breaches on clean rates", () => {
    const { breaches, notes } = evaluateThresholds({
      report: report(),
      thresholds: DEFAULT_THRESHOLDS,
      baseline: null,
    });
    expect(breaches).toEqual([]);
    expect(notes.join(" ")).toContain("baseline comparison skipped");
  });

  test("a dimension below its minimum pass rate breaches", () => {
    const { breaches } = evaluateThresholds({
      report: report({
        dimensionPassRates: {
          extractionCoverage: { passed: 6, applicable: 12 },
        },
      }),
      thresholds: DEFAULT_THRESHOLDS,
      baseline: null,
    });
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.rule).toBe("minDimensionPassRate.extractionCoverage");
  });

  test("code counts above their maxima breach", () => {
    const { breaches } = evaluateThresholds({
      report: report({
        taxonomyCounts: { "contract-violation": 1, "missed-stop": 4 },
      }),
      thresholds: DEFAULT_THRESHOLDS,
      baseline: null,
    });
    // contract-violation exceeds 0 and missed-stop exceeds 3.
    expect(breaches.map((breach) => breach.rule).sort()).toEqual([
      "maxCodeCounts.contract-violation",
      "maxCodeCounts.missed-stop",
    ]);
  });

  test("a pass-rate drop beyond the allowance vs baseline breaches", () => {
    const baseline = report({
      dimensionPassRates: {
        extractionCoverage: { passed: 12, applicable: 12 },
      },
    });
    const current = report({
      dimensionPassRates: {
        extractionCoverage: { passed: 10, applicable: 12 },
      },
    });
    const { breaches } = evaluateThresholds({
      report: current,
      thresholds: DEFAULT_THRESHOLDS,
      baseline,
    });
    expect(
      breaches.some(
        (breach) =>
          breach.rule === "maxPassRateDropVsBaseline.extractionCoverage",
      ),
    ).toBe(true);
  });

  test("a drop within the allowance does not breach", () => {
    const baseline = report({
      dimensionPassRates: {
        extractionCoverage: { passed: 12, applicable: 12 },
      },
    });
    const current = report({
      dimensionPassRates: {
        extractionCoverage: { passed: 11, applicable: 12 },
      },
    });
    const { breaches } = evaluateThresholds({
      report: current,
      thresholds: DEFAULT_THRESHOLDS,
      baseline,
    });
    expect(breaches).toEqual([]);
  });
});

describe("report assembly", () => {
  test("pass rates count only applicable dimensions", () => {
    const rates = collectDimensionPassRates([
      {
        briefId: "a",
        pass: true,
        dimensions: {
          extractionCoverage: { pass: true, applicable: true, detail: "" },
          questionEfficiency: { pass: true, applicable: false, detail: "" },
          contradictionHandling: { pass: true, applicable: true, detail: "" },
          stopCorrectness: { pass: false, applicable: true, detail: "" },
          contractDiscipline: { pass: true, applicable: true, detail: "" },
        },
      },
    ]);
    expect(rates["questionEfficiency"]).toEqual({ passed: 0, applicable: 0 });
    expect(rates["stopCorrectness"]).toEqual({ passed: 0, applicable: 1 });
  });

  test("the markdown projection carries untrusted reasons and spend", () => {
    const markdown = renderReportMarkdown(
      report({
        judgeAgreement: [
          {
            dimension: "faithfulness",
            exact: 0.95,
            withinOne: 0.95,
            samples: 20,
            inventedRecall: 0,
            trusted: false,
            untrustedReason: "invention recall 0.00 below the required 1.00",
          },
        ],
        phaseSpend: {
          capMicrocents: 1_500_000_000,
          settledActualMicrocents: 200_000_000,
          unresolvedReservationMicrocents: 0,
          remainingMicrocents: 1_300_000_000,
          consultantSettledMicrocents: 150_000_000,
          judgeSettledMicrocents: 50_000_000,
        },
      }),
      [{ rule: "x", detail: "y" }],
    );
    expect(markdown).toContain("UNTRUSTED (invention recall 0.00");
    expect(markdown).toContain("$2.0000 settled");
    expect(markdown).toContain("BREACH x: y");
  });
});
