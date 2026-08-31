import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  costOfUsageMicrocents,
  type ModelUsage,
} from "../server/model/pricing";
import type { ModelAlias } from "../server/model/config";
import { loadCorpus } from "./corpus";
import { listRuns, loadRun, type LoadedRun } from "./recordings";
import { replayBriefAgainstRun } from "./replay";
import { RecordingMissError } from "./replay-client";
import { scoreBrief, type BriefScore } from "./score";

// npm run eval — the separate, advisory offline evaluation command. It
// replays the corpus from recorded transcripts, scores it deterministically,
// and prints the result. It never calls a model: a hash miss rejects the run
// with instructions to capture, and exits nonzero. Thresholds and dated
// report files land in slice 4; until then the exit code is simply nonzero
// when any brief fails or the run cannot be used.

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

export async function runEval(input: {
  briefsDir: string;
  recordingsDir: string;
  runId?: string;
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
  log(`Run ${runId} (captured ${run.manifest.capturedAt}, commit ${run.manifest.gitCommit})`);

  const reports: BriefReport[] = [];
  for (const { brief, labels } of corpus) {
    const transcript = await replayBriefAgainstRun({ brief, run });
    reports.push({
      score: scoreBrief(transcript, labels),
      ...runCostAndLatency(run, brief.id),
    });
  }

  let failures = 0;
  let totalCost = 0;
  for (const report of reports) {
    const verdict = report.score.pass ? "pass" : "FAIL";
    if (!report.score.pass) {
      failures += 1;
    }
    totalCost += report.costMicrocents;
    log(
      `${verdict}  ${report.score.briefId}  (${report.calls} calls, ${usd(report.costMicrocents)} USD recorded, ${report.latencyMs} ms recorded)`,
    );
    for (const [name, dimension] of Object.entries(report.score.dimensions)) {
      if (dimension.applicable && !dimension.pass) {
        log(`      ${name}: ${dimension.detail}`);
      }
    }
  }
  log(
    `${reports.length - failures}/${reports.length} briefs pass; recorded run cost ${usd(totalCost)} USD (costs and latencies are from the capture pass, not this replay)`,
  );
  return { exitCode: failures > 0 ? 1 : 0 };
}

// CLI entry: tsx execution only; tests call runEval directly.
export async function main(): Promise<void> {
  const runId = process.argv[2];
  try {
    const { exitCode } = await runEval({
      briefsDir: join(process.cwd(), "eval/briefs"),
      recordingsDir: join(process.cwd(), "eval/recordings"),
      runId,
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
