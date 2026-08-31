import type { BriefScore } from "./score";

// Seed error taxonomy (spec, slice 3), extended only by evidence from actual
// failures. Every SCORED FAILURE — each failed dimension, plus a trusted
// judged faithfulness finding — carries exactly one primary code; a brief
// that fails several ways therefore contributes several codes, one per
// failure, never collapsed into a single "worst" code (that would undercount
// every co-occurring failure). Within a dimension whose detail can carry
// more than one problem kind, the mapping picks the more evidence-poisoning
// code. Counts per code appear in every report.

export const TAXONOMY_CODES = [
  "contract-violation",
  "invented-fact",
  "premature-stop-offer",
  "missed-stop",
  "wrong-citation",
  "missed-tension",
  "false-tension",
  "missed-core-gap",
  "redundant-question",
  "overlong-bundled-question",
] as const;

export type TaxonomyCode = (typeof TAXONOMY_CODES)[number];

// Deterministic mapping: one code per failed dimension. false-tension and
// overlong-bundled-question have no deterministic detector yet — they enter
// through judged evidence in later reports, and the enum reserves their
// names so counts stay comparable.
export function briefTaxonomyCodes(
  score: BriefScore,
  judged?: { inventedStatementIndexes: number[]; faithfulnessTrusted: boolean },
): TaxonomyCode[] {
  const codes: TaxonomyCode[] = [];
  const { dimensions } = score;

  if (!dimensions.contractDiscipline.pass) {
    codes.push("contract-violation");
  }
  if (
    dimensions.extractionCoverage.applicable &&
    !dimensions.extractionCoverage.pass
  ) {
    codes.push(
      dimensions.extractionCoverage.detail.includes("forbidden content")
        ? "invented-fact"
        : "missed-core-gap",
    );
  }
  if (
    dimensions.stopCorrectness.applicable &&
    !dimensions.stopCorrectness.pass
  ) {
    codes.push(
      dimensions.stopCorrectness.detail.includes("premature")
        ? "premature-stop-offer"
        : "missed-stop",
    );
  }
  if (
    dimensions.contradictionHandling.applicable &&
    !dimensions.contradictionHandling.pass
  ) {
    codes.push(
      dimensions.contradictionHandling.detail.includes("fewer than two")
        ? "wrong-citation"
        : "missed-tension",
    );
  }
  if (
    dimensions.questionEfficiency.applicable &&
    !dimensions.questionEfficiency.pass
  ) {
    codes.push("redundant-question");
  }
  // A trusted judged faithfulness finding is its own scored failure, distinct
  // from a deterministic forbidden-content hit. Untrusted findings never
  // count — calibration gating applies all the way down.
  if (
    judged &&
    judged.faithfulnessTrusted &&
    judged.inventedStatementIndexes.length > 0
  ) {
    codes.push("invented-fact");
  }

  if (!score.pass && codes.length === 0) {
    // A failed brief always has a failed dimension, so reaching here means a
    // new dimension was added without a taxonomy rule.
    throw new Error(
      `Brief ${score.briefId} failed but no taxonomy rule matched its dimensions`,
    );
  }
  return codes;
}

export function taxonomyCounts(
  codes: TaxonomyCode[],
): Record<TaxonomyCode, number> {
  const counts = Object.fromEntries(
    TAXONOMY_CODES.map((code) => [code, 0]),
  ) as Record<TaxonomyCode, number>;
  for (const code of codes) {
    counts[code] += 1;
  }
  return counts;
}
