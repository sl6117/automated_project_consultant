import { execSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { modelCatalog } from "../server/model/config";
import { createLiveModelClient } from "../server/model/live-client";
import {
  initializeBudget,
  readBudget,
  PER_BRIEF_CONSULTANT_CAP_MICROCENTS,
  PHASE_BUDGET_CAP_MICROCENTS,
} from "./budget";
import { runCaptureCampaign } from "./capture";
import { createLiveJudgeClient } from "./live-judge-client";

// Owner-initiated live capture. Every subcommand is explicit:
//   init-budget   — create eval/budget.jsonl with the approved $15 phase cap
//                   (runs once; an existing record is never replaced)
//   status        — print the budget record's current state
//   capture <run> — run the live capture campaign for <run-id>
// The campaign requires ANTHROPIC_API_KEY and LIVE_CAPTURE=yes in the
// environment, so a stray invocation cannot spend. Clear the key from the
// shell after every live window.

const PER_BRIEF_JUDGE_CAP_MICROCENTS = 50_000_000; // $0.50

function gitCommit(): string {
  return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
}

export async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  const budgetPath = join(process.cwd(), "eval/budget.jsonl");

  if (command === "init-budget") {
    initializeBudget(budgetPath, {
      capMicrocents: PHASE_BUDGET_CAP_MICROCENTS,
      note:
        argument ??
        "Phase 3 live budget authorized by the owner in the approved phase specification ($15).",
    });
    console.log(
      `Budget record created at ${budgetPath} with a ${PHASE_BUDGET_CAP_MICROCENTS} microcent ($15.00) cap. Commit it.`,
    );
    return;
  }

  if (command === "status") {
    const state = readBudget(budgetPath);
    console.log(
      JSON.stringify(
        {
          capMicrocents: state.capMicrocents,
          settledActualMicrocents: state.settledActualMicrocents,
          unresolvedReservationMicrocents:
            state.unresolvedReservationMicrocents,
          remainingMicrocents: state.remainingMicrocents,
          consultantSettledMicrocents: state.consultantSettledMicrocents,
          judgeSettledMicrocents: state.judgeSettledMicrocents,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "capture") {
    if (!argument) {
      console.error("Usage: capture <run-id>");
      process.exitCode = 2;
      return;
    }
    if (process.env.LIVE_CAPTURE !== "yes") {
      console.error(
        "Live capture requires LIVE_CAPTURE=yes in the environment — an explicit owner initiation, every time.",
      );
      process.exitCode = 2;
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("Live capture requires ANTHROPIC_API_KEY.");
      process.exitCode = 2;
      return;
    }

    const result = await runCaptureCampaign({
      briefsDir: join(process.cwd(), "eval/briefs"),
      recordingsDir: join(process.cwd(), "eval/recordings"),
      calibrationDir: join(process.cwd(), "eval/calibration"),
      budgetPath,
      runId: argument,
      consultant: createLiveModelClient(),
      judge: createLiveJudgeClient(),
      gitCommit: gitCommit(),
      models: {
        sonnet: modelCatalog.sonnet.apiId,
        fable: modelCatalog.fable.apiId,
      },
      promptVersionNote: `prompts as of commit ${gitCommit()}`,
      perBriefConsultantCapMicrocents: PER_BRIEF_CONSULTANT_CAP_MICROCENTS,
      perBriefJudgeCapMicrocents: PER_BRIEF_JUDGE_CAP_MICROCENTS,
      log: (line) => console.log(line),
    });
    console.log(
      "Reminder: clear ANTHROPIC_API_KEY from this shell now that the live window is over.",
    );
    process.exitCode = result.finalized && result.halted === null ? 0 : 1;
    return;
  }

  console.error("Usage: init-budget [note] | status | capture <run-id>");
  process.exitCode = 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void main();
}
