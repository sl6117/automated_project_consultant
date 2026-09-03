import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ModelClient } from "../server/model/client";
import { estimateRequestCostMicrocents } from "../server/model/pricing";
import {
  describeExtractionRequest,
  describeNextQuestionRequest,
} from "../server/model/prompt";
import { briefCommittedMicrocents, readBudget } from "./budget";
import {
  createBudgetedJudgeClient,
  createBudgetedModelClient,
  type BudgetedJudgeClient,
  type BudgetedModelClient,
} from "./budgeted-client";
import { createCapturingModelClient } from "./capture-client";
import { loadCorpus } from "./corpus";
import type { BriefLabels } from "./corpus-schemas";
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
  // Owner-approved per-brief consultant cap overrides (microcents), for a
  // brief whose accumulated failed-window spend needs headroom beyond the
  // default. The aggregate phase cap is never overridden.
  consultantCapOverrides?: Record<string, number>;
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

    const consultantCap =
      input.consultantCapOverrides?.[brief.id] ??
      input.perBriefConsultantCapMicrocents;

    const budgetState = readBudget(input.budgetPath);
    const remaining = budgetState.remainingMicrocents;
    const consultantCommitted = briefCommittedMicrocents(
      budgetState,
      input.runId,
      brief.id,
      "consultant",
    );
    const judgeCommitted = briefCommittedMicrocents(
      budgetState,
      input.runId,
      brief.id,
      "judge",
    );
    const needed =
      Math.max(0, consultantCap - consultantCommitted) +
      Math.max(0, input.perBriefJudgeCapMicrocents - judgeCommitted);
    if (remaining < needed) {
      incomplete.push(brief.id);
      log(
        `refuse ${brief.id}: remaining per-brief cap headroom (${needed}) no longer fits the remaining budget (${remaining})`,
      );
      continue;
    }

    // Preflight: an attempt must not BEGIN unless the brief's cap headroom
    // covers at least its opening calls (extraction plus the first ask,
    // estimated with an empty ledger — a floor, since context only grows).
    // Without this, a brief near its cap spends a real extraction only to
    // hit the deterministic refusal on the very next call.
    const openingEstimate =
      estimateRequestCostMicrocents(
        "sonnet",
        describeExtractionRequest({
          projectName: brief.projectName,
          idea: brief.idea,
        }),
      ) +
      estimateRequestCostMicrocents(
        "fable",
        describeNextQuestionRequest({
          projectName: brief.projectName,
          idea: brief.idea,
          approved: { statements: [], concerns: [] },
          context: {
            missingCoreCodes: [],
            openContradictions: [],
            resolvedQuestions: [],
          },
        }),
      );
    if (consultantCommitted + openingEstimate > consultantCap) {
      incomplete.push(brief.id);
      log(
        `refuse ${brief.id}: ${consultantCommitted} microcents already committed against its ${consultantCap} consultant cap; the opening calls need ~${openingEstimate} more. Owner approval of a per-brief cap override is required to continue this brief.`,
      );
      continue;
    }

    let succeeded = false;
    let budgetRefused = false;
    for (let attempt = 1; attempt <= 2 && !succeeded; attempt += 1) {
      const consultationEntries: RecordingEntry[] = [];
      const judgeEntries: RecordingEntry[] = [];
      const consultantClient: BudgetedModelClient = createBudgetedModelClient(
        createCapturingModelClient(input.consultant, {
          record: (entry) => consultationEntries.push(entry),
        }),
        {
          budgetPath: input.budgetPath,
          runId: input.runId,
          briefId: brief.id,
          perBriefCapMicrocents: consultantCap,
        },
      );
      let judgeClient: BudgetedJudgeClient | null = null;
      try {
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

        judgeClient = createBudgetedJudgeClient(
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
          labels,
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
        // A budget refusal is deterministic arithmetic, never transient:
        // retrying would re-spend the calls before it only to hit the same
        // cap. Stop this brief immediately and leave it incomplete.
        const refusals = [
          ...consultantClient.budgetRefusals,
          ...(judgeClient?.budgetRefusals ?? []),
        ];
        if (refusals.length > 0) {
          budgetRefused = true;
          log(
            `budget refusal on ${brief.id} — not retryable: ${refusals[0]!.message}`,
          );
          break;
        }
        if (attempt === 2) {
          halted = brief.id;
        }
      }
    }
    if (budgetRefused) {
      incomplete.push(brief.id);
      continue;
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
  labels: BriefLabels,
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
    // Only turns the judge will score: the owner's questionRankings that
    // actually occurred (judge-run.ts skips rankings for absent turns, and
    // calibration fails closed on any owner-scored turn the judge lacks).
    usefulnessByTurn: labels.questionRankings
      .filter((ranking) =>
        transcript.turns.some((turn) => turn.turn === ranking.turn),
      )
      .map((ranking) => ({
        turn: ranking.turn,
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
