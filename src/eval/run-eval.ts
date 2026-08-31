import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  costOfUsageMicrocents,
  type ModelUsage,
} from "../server/model/pricing";
import type { ModelAlias } from "../server/model/config";
import { readBudget } from "./budget";
import {
  calibrationLabelsSchema,
  computeAgreement,
  type CalibrationLabels,
  type JudgeBriefScores,
} from "./calibration";
import { loadCorpus } from "./corpus";
import { createReplayJudgeClient } from "./judge-client";
import { judgeTranscript } from "./judge-run";
import { listRuns, loadRun, type LoadedRun } from "./recordings";
import {
  collectDimensionPassRates,
  evaluateThresholds,
  loadBaselineReport,
  writeReport,
  type EvalReport,
} from "./report";
import { replayBriefAgainstRun } from "./replay";
import { RecordingMissError } from "./replay-client";
import { scoreBrief, type BriefScore } from "./score";
import { briefTaxonomyCodes, taxonomyCounts } from "./taxonomy";
import { loadThresholds } from "./thresholds";

// npm run eval — the separate, advisory offline evaluation command. It
// replays the corpus from recorded transcripts, scores it deterministically,
// replays the judge where judge recordings and owner calibration labels
// exist, compares against the committed thresholds, and (with a label)
// writes a dated report pair to eval/reports/. It never calls a model: a
// hash miss rejects the run and exits nonzero. The gate is advisory — the
// exit code reports, nothing blocks.

type BriefReport = {
  score: BriefScore;
  costMicrocents: number;
  latencyMs: number;
  calls: number;
};

// A microcent is one millionth of a cent, so dollars = microcents / 1e8.
const MICROCENTS_PER_USD = 100_000_000;

function usd(microcents: number): string {
  return (microcents / MICROCENTS_PER_USD).toFixed(4);
}

function runCostAndLatency(
  run: LoadedRun,
  briefId: string,
): { costMicrocents: number; latencyMs: number; calls: number } {
  const entries = run.entriesByBrief.get(briefId) ?? [];
  let costMicrocents = 0;
  let latencyMs = 0;
  for (const entry of entries) {
    if (entry.usage) {
      costMicrocents += costOfUsageMicrocents(
        entry.modelAlias as ModelAlias,
        entry.usage as ModelUsage,
      );
    }
    latencyMs += entry.latencyMs;
  }
  return { costMicrocents, latencyMs, calls: entries.length };
}

function loadCalibrationLabels(
  calibrationDir: string,
  runId: string,
  briefId: string,
): CalibrationLabels | null {
  const path = join(calibrationDir, runId, `${briefId}.json`);
  if (!existsSync(path)) {
    return null;
  }
  return calibrationLabelsSchema.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
}

export async function runEval(input: {
  briefsDir: string;
  recordingsDir: string;
  calibrationDir: string;
  reportsDir: string;
  thresholdsPath: string;
  budgetPath: string;
  runId?: string;
  reportLabel?: string;
  log: (line: string) => void;
}): Promise<{ exitCode: number }> {
  const { log } = input;

  const runs = listRuns(input.recordingsDir);
  const runId = input.runId ?? (runs.length === 1 ? runs[0] : undefined);
  if (!runId) {
    log(
      runs.length === 0
        ? "No recorded runs exist yet — an owner-initiated capture pass is required before eval can replay anything."
        : `Multiple runs exist (${runs.join(", ")}); pass the run id to evaluate.`,
    );
    return { exitCode: 1 };
  }

  const run = loadRun(input.recordingsDir, runId);
  const corpus = loadCorpus(input.briefsDir);
  const thresholds = loadThresholds(input.thresholdsPath);
  const notes: string[] = [];
  log(
    `Run ${runId} (captured ${run.manifest.capturedAt}, commit ${run.manifest.gitCommit})`,
  );

  const reports: BriefReport[] = [];
  const judgePairs: { judge: JudgeBriefScores; owner: CalibrationLabels }[] =
    [];
  const allJudgeScores: JudgeBriefScores[] = [];
  let unauthoredCalibration = 0;

  for (const { brief, labels } of corpus) {
    const transcript = await replayBriefAgainstRun({ brief, run });
    reports.push({
      score: scoreBrief(transcript, labels),
      ...runCostAndLatency(run, brief.id),
    });

    const hasJudgeEntries = (run.entriesByBrief.get(brief.id) ?? []).some(
      (entry) => entry.task.startsWith("judge-"),
    );
    if (!hasJudgeEntries) {
      continue;
    }
    const judgeClient = createReplayJudgeClient(run);
    const judgeScores = await judgeTranscript({
      brief,
      transcript,
      labels,
      client: judgeClient,
    });
    if (judgeClient.misses.length > 0) {
      throw judgeClient.misses[0]!;
    }
    allJudgeScores.push(judgeScores);
    const owner = loadCalibrationLabels(
      input.calibrationDir,
      runId,
      brief.id,
    );
    if (owner === null) {
      continue;
    }
    if (owner.status !== "authored") {
      unauthoredCalibration += 1;
      continue;
    }
    judgePairs.push({ judge: judgeScores, owner });
  }

  const judgeAgreement =
    judgePairs.length > 0 ? computeAgreement(judgePairs) : null;
  if (allJudgeScores.length > 0 && judgePairs.length === 0) {
    notes.push(
      unauthoredCalibration > 0
        ? `Judge recordings exist but ${unauthoredCalibration} calibration file(s) are still templates; every judged dimension is untrusted until the owner authors them.`
        : "Judge recordings exist but no calibration labels do; every judged dimension is untrusted.",
    );
  }

  // Judged score means over EVERY judged brief; trusted only where the
  // calibration subset says so — with no calibration, nothing is trusted.
  const judgedScoreMeans =
    allJudgeScores.length === 0
      ? null
      : (() => {
          const trustOf = (dimension: string): boolean =>
            judgeAgreement?.find((entry) => entry.dimension === dimension)
              ?.trusted ?? false;
          let statements = 0;
          let grounded = 0;
          let usefulnessSum = 0;
          let usefulnessCount = 0;
          let sufficiencySum = 0;
          for (const scores of allJudgeScores) {
            statements += scores.statementCount;
            grounded +=
              scores.statementCount - scores.inventedStatementIndexes.length;
            for (const turn of scores.usefulnessByTurn) {
              usefulnessSum += turn.score;
              usefulnessCount += 1;
            }
            sufficiencySum += scores.minimumSufficiency.score;
          }
          return [
            {
              dimension: "faithfulness" as const,
              mean: statements === 0 ? 1 : grounded / statements,
              samples: statements,
              trusted: trustOf("faithfulness"),
            },
            {
              dimension: "usefulness" as const,
              mean: usefulnessCount === 0 ? 0 : usefulnessSum / usefulnessCount,
              samples: usefulnessCount,
              trusted: trustOf("usefulness"),
            },
            {
              dimension: "sufficiency" as const,
              mean: sufficiencySum / allJudgeScores.length,
              samples: allJudgeScores.length,
              trusted: trustOf("sufficiency"),
            },
          ];
        })();

  let phaseSpend: EvalReport["phaseSpend"] = null;
  try {
    const budget = readBudget(input.budgetPath);
    phaseSpend = {
      capMicrocents: budget.capMicrocents,
      settledActualMicrocents: budget.settledActualMicrocents,
      unresolvedReservationMicrocents:
        budget.unresolvedReservationMicrocents,
      remainingMicrocents: budget.remainingMicrocents,
      consultantSettledMicrocents: budget.consultantSettledMicrocents,
      judgeSettledMicrocents: budget.judgeSettledMicrocents,
    };
  } catch (error) {
    // A written report must state phase spend against the cap; only an
    // ad-hoc console run may proceed with the gap noted.
    if (input.reportLabel) {
      throw new Error(
        `Cannot write a report without a readable budget record: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    notes.push("No readable budget record; phase spend unavailable.");
  }

  const codesPerBrief = reports.map((report) =>
    briefTaxonomyCodes(report.score),
  );
  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    runId,
    runGitCommit: run.manifest.gitCommit,
    briefs: reports.map((entry, index) => ({
      briefId: entry.score.briefId,
      pass: entry.score.pass,
      taxonomyCodes: codesPerBrief[index]!,
      failedDimensionDetails: Object.fromEntries(
        Object.entries(entry.score.dimensions)
          .filter(
            ([, dimension]) => dimension.applicable && !dimension.pass,
          )
          .map(([name, dimension]) => [name, dimension.detail]),
      ),
      costMicrocents: entry.costMicrocents,
      latencyMs: entry.latencyMs,
      calls: entry.calls,
    })),
    dimensionPassRates: collectDimensionPassRates(
      reports.map((entry) => entry.score),
    ),
    taxonomyCounts: taxonomyCounts(codesPerBrief.flat()),
    judgeAgreement,
    judgedScoreMeans,
    phaseSpend,
    notes,
  };

  const baseline = thresholds.baselineReport
    ? loadBaselineReport(input.reportsDir, thresholds.baselineReport)
    : null;
  const evaluated = evaluateThresholds({ report, thresholds, baseline });
  report.notes.push(...evaluated.notes);

  let failures = 0;
  for (const [index, entry] of reports.entries()) {
    const codes = codesPerBrief[index]!;
    const verdict = entry.score.pass ? "pass" : `FAIL [${codes.join(", ")}]`;
    if (!entry.score.pass) {
      failures += 1;
    }
    log(
      `${verdict}  ${entry.score.briefId}  (${entry.calls} calls, ${usd(entry.costMicrocents)} USD recorded, ${entry.latencyMs} ms recorded)`,
    );
    for (const [name, dimension] of Object.entries(entry.score.dimensions)) {
      if (dimension.applicable && !dimension.pass) {
        log(`      ${name}: ${dimension.detail}`);
      }
    }
  }
  if (failures > 0) {
    const counts = report.taxonomyCounts;
    const summary = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([code, count]) => `${code}: ${count}`)
      .join(", ");
    log(`Failure taxonomy: ${summary}`);
  }
  if (judgeAgreement) {
    for (const agreement of judgeAgreement) {
      log(
        `judge ${agreement.dimension}: exact ${agreement.exact.toFixed(2)}, within-one ${agreement.withinOne.toFixed(2)}, ${agreement.samples} samples — ${agreement.trusted ? "TRUSTED" : `UNTRUSTED (${agreement.untrustedReason})`}`,
      );
    }
  }
  for (const breach of evaluated.breaches) {
    log(`BREACH ${breach.rule}: ${breach.detail}`);
  }
  for (const note of report.notes) {
    log(`note: ${note}`);
  }
  const totalCost = reports.reduce(
    (sum, entry) => sum + entry.costMicrocents,
    0,
  );
  log(
    `${reports.length - failures}/${reports.length} briefs pass; recorded run cost ${usd(totalCost)} USD (costs and latencies are from the capture pass, not this replay)` +
      (phaseSpend
        ? `; phase spend ${usd(phaseSpend.settledActualMicrocents)} of ${usd(phaseSpend.capMicrocents)} USD`
        : ""),
  );

  if (input.reportLabel) {
    const written = writeReport(
      input.reportsDir,
      input.reportLabel,
      report,
      evaluated.breaches,
    );
    log(`Report written: ${written.jsonPath} (+ .md)`);
  }

  return {
    exitCode: failures > 0 || evaluated.breaches.length > 0 ? 1 : 0,
  };
}

// CLI entry: tsx execution only; tests call runEval directly.
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reportFlag = args.indexOf("--report");
  const reportLabel =
    reportFlag >= 0 ? args[reportFlag + 1] : undefined;
  const positional = args.filter(
    (value, index) =>
      index !== reportFlag && index !== reportFlag + 1,
  );
  try {
    const { exitCode } = await runEval({
      briefsDir: join(process.cwd(), "eval/briefs"),
      recordingsDir: join(process.cwd(), "eval/recordings"),
      calibrationDir: join(process.cwd(), "eval/calibration"),
      reportsDir: join(process.cwd(), "eval/reports"),
      thresholdsPath: join(process.cwd(), "eval/thresholds.json"),
      budgetPath: join(process.cwd(), "eval/budget.jsonl"),
      runId: positional[0],
      reportLabel,
      log: (line) => console.log(line),
    });
    process.exitCode = exitCode;
  } catch (error) {
    if (error instanceof RecordingMissError) {
      console.error(error.message);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
