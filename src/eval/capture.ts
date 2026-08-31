import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ModelClient } from "../server/model/client";
import { readBudget } from "./budget";
import {
  createBudgetedJudgeClient,
  createBudgetedModelClient,
} from "./budgeted-client";
import { createCapturingModelClient } from "./capture-client";
import { loadCorpus } from "./corpus";
import { createCapturingJudgeClient, type JudgeClient } from "./judge-client";
import { judgeTranscript } from "./judge-run";
import {
  briefRecordingExists,
  finalizeRun,
  sanitizationFindings,
  writeBriefRecording,
  type RecordingEntry,
  type RunManifest,
} from "./recordings";
import { replayBrief, type ReplayTranscript } from "./replay";

// The owner-initiated capture campaign: drives every corpus brief through
// the pipeline against the supplied clients (live for the real baseline;
// synthetic in tests), capturing consultant and judge calls under the
// two-phase budget contract. Recovery rules (spec):
// - a brief whose consultation completes is finalized and never re-run
//   within the pass; re-running the campaign retries only incomplete briefs;
// - a mid-brief failure keeps its spend (settlements already appended) but
//   DISCARDS the partial recording — spliced transcripts are not
//   reproducible — and the brief stays incomplete;
// - two consecutive failures on the same brief halt the pass for owner
//   review instead of a third attempt;
// - a brief is not started when the per-brief caps no longer fit the
//   remaining phase budget;
// - the manifest is written only when every corpus brief has recordings, so
//   a partial pass can never be loaded as a run.

export type CaptureResult = {
  completedBriefIds: string[];
  skippedExistingBriefIds: string[];
  incompleteBriefIds: string[];
  halted: string | null;
  finalized: boolean;
};

export async function runCaptureCampaign(input: {
  briefsDir: string;
  recordingsDir: string;
  calibrationDir: string;
  budgetPath: string;
  runId: string;
  consultant: ModelClient;
  judge: JudgeClient;
  gitCommit: string;
  models: Record<string, string>;
  promptVersionNote: string;
  perBriefConsultantCapMicrocents: number;
  perBriefJudgeCapMicrocents: number;
  log: (line: string) => void;
}): Promise<CaptureResult> {
  const { log } = input;
  // Fail closed before any spend: a missing or corrupt budget record refuses
  // the whole campaign.
  const opening = readBudget(input.budgetPath);
  log(
    `Budget: ${opening.remainingMicrocents} microcents remain of ${opening.capMicrocents}`,
  );

  const corpus = loadCorpus(input.briefsDir);
  const completed: string[] = [];
  const skipped: string[] = [];
  const incomplete: string[] = [];
  let halted: string | null = null;

  for (const { brief, labels } of corpus) {
    if (briefRecordingExists(input.recordingsDir, input.runId, brief.id)) {
      skipped.push(brief.id);
      log(`skip ${brief.id}: already recorded in this run`);
      continue;
    }

    const remaining = readBudget(input.budgetPath).remainingMicrocents;
    const needed =
      input.perBriefConsultantCapMicrocents +
      input.perBriefJudgeCapMicrocents;
    if (remaining < needed) {
      incomplete.push(brief.id);
      log(
        `refuse ${brief.id}: per-brief caps (${needed}) no longer fit the remaining budget (${remaining})`,
      );
      continue;
    }

    let succeeded = false;
    for (let attempt = 1; attempt <= 2 && !succeeded; attempt += 1) {
      const consultationEntries: RecordingEntry[] = [];
      const judgeEntries: RecordingEntry[] = [];
      try {
        const consultantClient = createBudgetedModelClient(
          createCapturingModelClient(input.consultant, {
            record: (entry) => consultationEntries.push(entry),
          }),
          {
            budgetPath: input.budgetPath,
            runId: input.runId,
            briefId: brief.id,
            perBriefCapMicrocents: input.perBriefConsultantCapMicrocents,
          },
        );
        const transcript = await replayBrief({
          brief,
          client: consultantClient,
        });
        if (
          transcript.outcome === "start-failed" ||
          transcript.outcome === "aborted-validation"
        ) {
          throw new Error(
            `consultation ${transcript.outcome}: ${transcript.failureDetail ?? "unknown"}`,
          );
        }

        const judgeClient = createBudgetedJudgeClient(
          createCapturingJudgeClient(input.judge, {
            record: (entry) => judgeEntries.push(entry),
          }),
          {
            budgetPath: input.budgetPath,
            runId: input.runId,
            briefId: brief.id,
            perBriefCapMicrocents: input.perBriefJudgeCapMicrocents,
          },
        );
        await judgeTranscript({
          brief,
          transcript,
          labels,
          client: judgeClient,
        });

        writeBriefRecording(input.recordingsDir, input.runId, brief.id, {
          consultation: consultationEntries,
          judge: judgeEntries,
        });
        writeCalibrationTemplate(
          input.calibrationDir,
          input.runId,
          transcript,
        );
        completed.push(brief.id);
        succeeded = true;
        log(`done ${brief.id} (attempt ${attempt})`);
      } catch (error) {
        // Spend receipts are already settled in the budget record; the
        // partial recording is discarded by dropping the in-memory entries.
        log(
          `fail ${brief.id} attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (attempt === 2) {
          halted = brief.id;
        }
      }
    }
    if (halted) {
      incomplete.push(brief.id);
      log(
        `HALT: two consecutive failures on ${brief.id}; owner review required before any further attempt`,
      );
      break;
    }
  }

  const allRecorded = corpus.every(({ brief }) =>
    briefRecordingExists(input.recordingsDir, input.runId, brief.id),
  );
  if (allRecorded) {
    const manifest: Omit<RunManifest, "files"> = {
      runId: input.runId,
      capturedAt: new Date().toISOString(),
      gitCommit: input.gitCommit,
      models: input.models,
      promptVersionNote: input.promptVersionNote,
      briefIds: corpus.map(({ brief }) => brief.id),
    };
    finalizeRun(input.recordingsDir, manifest);
    log(`Run ${input.runId} finalized: manifest and detached hash written`);
  } else {
    log(
      `Run ${input.runId} NOT finalized: ${incomplete.length} brief(s) incomplete; re-run the campaign to retry them`,
    );
  }

  const closing = readBudget(input.budgetPath);
  log(
    `Budget after pass: settled ${closing.settledActualMicrocents} (consultant ${closing.consultantSettledMicrocents}, judge ${closing.judgeSettledMicrocents}), remaining ${closing.remainingMicrocents}`,
  );

  return {
    completedBriefIds: completed,
    skippedExistingBriefIds: skipped,
    incompleteBriefIds: incomplete,
    halted,
    finalized: allRecorded,
  };
}

// The owner authors calibration labels against this run's real transcripts;
// the template pre-fills the turns and a companion markdown shows the
// numbered statements, turns, and SPEC so the owner can judge them.
function writeCalibrationTemplate(
  calibrationDir: string,
  runId: string,
  transcript: ReplayTranscript,
): void {
  const dir = join(calibrationDir, runId);
  mkdirSync(dir, { recursive: true });
  const labelsPath = join(dir, `${transcript.briefId}.json`);
  if (existsSync(labelsPath)) {
    // Never overwrite: the owner may already have authored it.
    return;
  }
  const template = {
    briefId: transcript.briefId,
    runId,
    status: "template",
    instructions:
      "Owner-authored only. Judge THIS RUN's transcript (see the companion .transcript.md): list the statement indexes that are invented relative to the brief, score each listed turn's question usefulness 1-5, score the artifact set's minimum-sufficiency 1-5, then set status to \"authored\". Placeholder 3s must be replaced with your real scores.",
    inventedStatementIndexes: [],
    usefulnessByTurn: transcript.turns.map((turn) => ({
      turn: turn.turn,
      score: 3,
    })),
    minimumSufficiency: 3,
  };
  const companion = [
    `# ${transcript.briefId} — run ${runId} transcript for calibration`,
    "",
    "## Approved statements (index: kind: body)",
    ...transcript.approvedStatements.map(
      (statement, index) => `- [${index}] ${statement.kind}: ${statement.body}`,
    ),
    "",
    "## Turns",
    ...transcript.turns.map(
      (turn) =>
        `- Turn ${turn.turn}: Q: ${turn.questionBody} | A (${turn.answerDisposition}): ${turn.answerBody || "(none)"}`,
    ),
    "",
    `Outcome: ${transcript.outcome}; stop offered at turn ${transcript.stopOfferedAtTurn ?? "never"}`,
    "",
    "## SPEC.md",
    "",
    transcript.artifacts.find((file) => file.filename === "SPEC.md")?.body ??
      "(no artifact set)",
    "",
  ].join("\n");

  const labelsText = JSON.stringify(template, null, 2) + "\n";
  for (const [name, text] of [
    [`${transcript.briefId}.json`, labelsText],
    [`${transcript.briefId}.transcript.md`, companion],
  ] as const) {
    const findings = sanitizationFindings(text);
    if (findings.length > 0) {
      throw new Error(
        `Calibration file ${name} failed the sanitization scan: ${findings.join(", ")}`,
      );
    }
  }
  writeFileSync(labelsPath, labelsText, "utf8");
  writeFileSync(
    join(dir, `${transcript.briefId}.transcript.md`),
    companion,
    "utf8",
  );
}
