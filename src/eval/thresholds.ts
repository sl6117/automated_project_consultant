import { readFileSync } from "node:fs";
import { z } from "zod";
import { TAXONOMY_CODES } from "./taxonomy";

// Regression thresholds live in one committed configuration file. The gate
// is advisory by design: npm run eval exits nonzero on breach and nothing
// else blocks. The config is strict and complete: every known deterministic
// dimension, every taxonomy code, and every judged dimension MUST appear,
// and unknown keys are rejected — a typo can therefore never silently
// disable a threshold, and adding a dimension or code without deciding its
// threshold fails loudly here.

export const DETERMINISTIC_DIMENSIONS = [
  "extractionCoverage",
  "questionEfficiency",
  "contradictionHandling",
  "stopCorrectness",
  "contractDiscipline",
] as const;

const passRateEntries = Object.fromEntries(
  DETERMINISTIC_DIMENSIONS.map((dimension) => [
    dimension,
    z.number().min(0).max(1),
  ]),
) as Record<(typeof DETERMINISTIC_DIMENSIONS)[number], z.ZodNumber>;

const codeCountEntries = Object.fromEntries(
  TAXONOMY_CODES.map((code) => [code, z.number().int().min(0)]),
) as Record<(typeof TAXONOMY_CODES)[number], z.ZodNumber>;

export const thresholdsSchema = z.strictObject({
  // The designated baseline report filename in eval/reports/, or null before
  // the first baseline exists (comparison is skipped and noted).
  baselineReport: z.string().min(1).nullable(),
  // Minimum pass rate per deterministic dimension, over briefs where the
  // dimension is applicable. Complete: all five dimensions, nothing else.
  minDimensionPassRate: z.strictObject(passRateEntries),
  // Maximum count per taxonomy code across the whole corpus. Complete: every
  // seed code carries an explicit maximum, so leniency is visible policy,
  // never an omission.
  maxCodeCounts: z.strictObject(codeCountEntries),
  // Minimum means for the judged dimensions, applied ONLY while the
  // dimension is trusted by calibration; untrusted dimensions are excluded
  // from threshold evaluation and reported as excluded.
  minJudgedScoreMean: z.strictObject({
    // Share of statements judged grounded, 0-1.
    faithfulness: z.number().min(0).max(1),
    // 1-5 scale means.
    usefulness: z.number().min(1).max(5),
    sufficiency: z.number().min(1).max(5),
  }),
  // Maximum allowed drop in any dimension pass rate vs the baseline report.
  maxPassRateDropVsBaseline: z.number().min(0).max(1),
});

export type Thresholds = z.infer<typeof thresholdsSchema>;

export const DEFAULT_THRESHOLDS: Thresholds = {
  baselineReport: null,
  minDimensionPassRate: {
    extractionCoverage: 0.8,
    questionEfficiency: 0.7,
    contradictionHandling: 0.8,
    stopCorrectness: 0.8,
    contractDiscipline: 1,
  },
  maxCodeCounts: {
    "contract-violation": 0,
    "invented-fact": 0,
    "premature-stop-offer": 1,
    "missed-stop": 3,
    "wrong-citation": 2,
    "missed-tension": 3,
    "false-tension": 3,
    "missed-core-gap": 3,
    "redundant-question": 4,
    "overlong-bundled-question": 4,
  },
  minJudgedScoreMean: {
    faithfulness: 0.95,
    usefulness: 3,
    sufficiency: 3,
  },
  maxPassRateDropVsBaseline: 0.1,
};

export function loadThresholds(path: string): Thresholds {
  const parsed = thresholdsSchema.safeParse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (!parsed.success) {
    throw new Error(`Threshold config ${path} is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}
