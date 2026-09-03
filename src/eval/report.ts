import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { DimensionAgreement } from "./calibration";
import type { BriefScore } from "./score";
import type { TaxonomyCode } from "./taxonomy";
import type { Thresholds } from "./thresholds";

// Dated report files under eval/reports/: committed, append-only. The JSON
// file is the record; the .md beside it is a readable projection. Recorded
// runs report the capture pass's real cost and latency and say so; judged
// dimensions always carry their calibration agreement beside them and are
// marked untrusted below threshold.

export type EvalReport = {
  generatedAt: string;
  runId: string;
  runGitCommit: string;
  briefs: {
    briefId: string;
    pass: boolean;
    taxonomyCodes: TaxonomyCode[];
    failedDimensionDetails: Record<string, string>;
    costMicrocents: number;
    latencyMs: number;
    calls: number;
  }[];
  dimensionPassRates: Record<string, { passed: number; applicable: number }>;
  taxonomyCounts: Record<string, number>;
  judgeAgreement: DimensionAgreement[] | null;
  // Mean judged scores over every brief with judge recordings (not only the
  // calibration subset). trusted mirrors the calibration verdict; an
  // untrusted mean is shown but excluded from threshold evaluation.
  judgedScoreMeans:
    | {
        dimension: "faithfulness" | "usefulness" | "sufficiency";
        mean: number;
        samples: number;
        trusted: boolean;
      }[]
    | null;
  phaseSpend: {
    capMicrocents: number;
    settledActualMicrocents: number;
    unresolvedReservationMicrocents: number;
    remainingMicrocents: number;
    consultantSettledMicrocents: number;
    judgeSettledMicrocents: number;
  } | null;
  notes: string[];
};

export function collectDimensionPassRates(
  scores: BriefScore[],
): EvalReport["dimensionPassRates"] {
  const rates: EvalReport["dimensionPassRates"] = {};
  for (const score of scores) {
    for (const [name, dimension] of Object.entries(score.dimensions)) {
      const entry = (rates[name] ??= { passed: 0, applicable: 0 });
      if (dimension.applicable) {
        entry.applicable += 1;
        if (dimension.pass) {
          entry.passed += 1;
        }
      }
    }
  }
  return rates;
}

function rate(entry: { passed: number; applicable: number }): number {
  return entry.applicable === 0 ? 1 : entry.passed / entry.applicable;
}

export type ThresholdBreach = { rule: string; detail: string };

// Evaluates the advisory thresholds; a baseline of null skips the comparison
// and says so in the returned notes.
export function evaluateThresholds(input: {
  report: EvalReport;
  thresholds: Thresholds;
  baseline: EvalReport | null;
}): { breaches: ThresholdBreach[]; notes: string[] } {
  const breaches: ThresholdBreach[] = [];
  const notes: string[] = [];
  const { report, thresholds, baseline } = input;

  for (const [dimension, minimum] of Object.entries(
    thresholds.minDimensionPassRate,
  )) {
    const entry = report.dimensionPassRates[dimension];
    if (!entry) {
      continue;
    }
    const actual = rate(entry);
    if (actual < minimum) {
      breaches.push({
        rule: `minDimensionPassRate.${dimension}`,
        detail: `${(actual * 100).toFixed(0)}% (${entry.passed}/${entry.applicable}) below the ${(minimum * 100).toFixed(0)}% minimum`,
      });
    }
  }

  for (const [code, maximum] of Object.entries(thresholds.maxCodeCounts)) {
    const count = report.taxonomyCounts[code] ?? 0;
    if (count > maximum) {
      breaches.push({
        rule: `maxCodeCounts.${code}`,
        detail: `${count} occurrence(s), more than the allowed ${maximum}`,
      });
    }
  }

  if (report.judgedScoreMeans !== null) {
    for (const entry of report.judgedScoreMeans) {
      const minimum = thresholds.minJudgedScoreMean[entry.dimension];
      if (!entry.trusted) {
        notes.push(
          `Judged ${entry.dimension} mean ${entry.mean.toFixed(2)} EXCLUDED from thresholds: dimension untrusted by calibration.`,
        );
        continue;
      }
      if (entry.mean < minimum) {
        breaches.push({
          rule: `minJudgedScoreMean.${entry.dimension}`,
          detail: `trusted mean ${entry.mean.toFixed(2)} over ${entry.samples} sample(s) below the ${minimum} minimum`,
        });
      }
    }
  }

  if (baseline === null) {
    notes.push(
      "No baseline report designated; baseline comparison skipped. The first owner-accepted report becomes the baseline in eval/thresholds.json.",
    );
  } else {
    for (const [dimension, entry] of Object.entries(
      report.dimensionPassRates,
    )) {
      const baselineEntry = baseline.dimensionPassRates[dimension];
      if (!baselineEntry) {
        continue;
      }
      const drop = rate(baselineEntry) - rate(entry);
      if (drop > thresholds.maxPassRateDropVsBaseline) {
        breaches.push({
          rule: `maxPassRateDropVsBaseline.${dimension}`,
          detail: `dropped ${(drop * 100).toFixed(0)} points vs baseline ${baseline.runId} (${(rate(baselineEntry) * 100).toFixed(0)}% -> ${(rate(entry) * 100).toFixed(0)}%)`,
        });
      }
    }
  }

  return { breaches, notes };
}

function usd(microcents: number): string {
  return (microcents / 100_000_000).toFixed(4);
}

export function renderReportMarkdown(
  report: EvalReport,
  breaches: ThresholdBreach[],
): string {
  const lines: string[] = [
    `# Evaluation report — run ${report.runId}`,
    "",
    `Generated ${report.generatedAt} from recordings captured at commit ${report.runGitCommit}. Costs and latencies are from the capture pass, not this replay.`,
    "",
    "## Briefs",
    "",
  ];
  for (const brief of report.briefs) {
    const verdict = brief.pass
      ? "pass"
      : `FAIL [${brief.taxonomyCodes.join(", ")}]`;
    lines.push(
      `- ${verdict} — ${brief.briefId} (${brief.calls} calls, $${usd(brief.costMicrocents)}, ${brief.latencyMs} ms)`,
    );
    for (const [dimension, detail] of Object.entries(
      brief.failedDimensionDetails,
    )) {
      lines.push(`  - ${dimension}: ${detail}`);
    }
  }
  lines.push("", "## Dimension pass rates", "");
  for (const [dimension, entry] of Object.entries(report.dimensionPassRates)) {
    lines.push(
      `- ${dimension}: ${entry.passed}/${entry.applicable} applicable`,
    );
  }
  lines.push("", "## Judged dimensions", "");
  if (report.judgedScoreMeans === null) {
    lines.push(
      "- No judge recordings for this run; judged dimensions unavailable.",
    );
  } else {
    for (const entry of report.judgedScoreMeans) {
      lines.push(
        `- ${entry.dimension} mean ${entry.mean.toFixed(2)} over ${entry.samples} sample(s) — ${entry.trusted ? "trusted, counted against thresholds" : "UNTRUSTED, excluded from thresholds"}`,
      );
    }
  }
  lines.push("", "## Judge calibration", "");
  if (report.judgeAgreement === null) {
    lines.push(
      "- No authored calibration labels for this run; the judge is uncalibrated and every judged dimension is untrusted.",
    );
  } else {
    for (const agreement of report.judgeAgreement) {
      const trust = agreement.trusted
        ? "TRUSTED"
        : `UNTRUSTED (${agreement.untrustedReason})`;
      const recall =
        agreement.inventedRecall === null
          ? ""
          : `, invention recall ${agreement.inventedRecall.toFixed(2)}`;
      lines.push(
        `- ${agreement.dimension}: exact ${agreement.exact.toFixed(2)}, within-one ${agreement.withinOne.toFixed(2)}, ${agreement.samples} samples${recall} — ${trust}`,
      );
    }
  }
  lines.push("", "## Phase spend", "");
  if (report.phaseSpend === null) {
    // Written reports refuse a missing budget record before reaching here
    // (see writeReport); this line can only appear in an ad-hoc rendering.
    lines.push("- No budget record available to this replay.");
  } else {
    const spend = report.phaseSpend;
    lines.push(
      `- $${usd(spend.settledActualMicrocents)} settled (consultant $${usd(spend.consultantSettledMicrocents)}, judge $${usd(spend.judgeSettledMicrocents)}) + $${usd(spend.unresolvedReservationMicrocents)} unresolved reservations of the $${usd(spend.capMicrocents)} cap; $${usd(spend.remainingMicrocents)} remains.`,
    );
  }
  lines.push("", "## Thresholds", "");
  if (breaches.length === 0) {
    lines.push("- No breaches.");
  } else {
    for (const breach of breaches) {
      lines.push(`- BREACH ${breach.rule}: ${breach.detail}`);
    }
  }
  for (const note of report.notes) {
    lines.push("", `> ${note}`);
  }
  return lines.join("\n") + "\n";
}

export function writeReport(
  reportsDir: string,
  label: string,
  report: EvalReport,
  breaches: ThresholdBreach[],
): { jsonPath: string; mdPath: string } {
  // A written report must state phase spend against the cap: a corrupt or
  // missing budget record refuses the report rather than hiding behind an
  // "unavailable" line.
  if (report.phaseSpend === null) {
    throw new Error(
      "Refusing to write a report without a readable budget record: every written report states phase spend against the cap",
    );
  }
  const date = report.generatedAt.slice(0, 10);
  const base = `${date}-${label}`;
  const jsonPath = join(reportsDir, `${base}.json`);
  const mdPath = join(reportsDir, `${base}.md`);
  // Reports are append-only: an existing pair is history, never overwritten.
  for (const path of [jsonPath, mdPath]) {
    if (existsSync(path)) {
      throw new Error(
        `Report ${path} already exists; reports are append-only — pick a different label`,
      );
    }
  }
  // The first report of a phase creates eval/reports/ itself; the directory
  // is not committed until a report lives in it.
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(mdPath, renderReportMarkdown(report, breaches), "utf8");
  return { jsonPath, mdPath };
}

// Reports are data produced by this code; the loose parse here only guards
// against loading a non-report file as a baseline.
const reportShapeSchema = z.object({
  generatedAt: z.string(),
  runId: z.string(),
  dimensionPassRates: z.record(
    z.string(),
    z.object({ passed: z.number(), applicable: z.number() }),
  ),
});

export function loadBaselineReport(
  reportsDir: string,
  filename: string,
): EvalReport {
  const parsed = reportShapeSchema.safeParse(
    JSON.parse(readFileSync(join(reportsDir, filename), "utf8")),
  );
  if (!parsed.success) {
    throw new Error(
      `Baseline report ${filename} is not a valid report: ${parsed.error.message}`,
    );
  }
  return parsed.data as EvalReport;
}
