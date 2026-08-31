import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ModelClient } from "../../../src/server/model/client";
import { initializeBudget, readBudget } from "../../../src/eval/budget";
import { runCaptureCampaign } from "../../../src/eval/capture";
import type { JudgeClient } from "../../../src/eval/judge-client";
import { loadRun } from "../../../src/eval/recordings";
import { replayBriefAgainstRun } from "../../../src/eval/replay";

// Offline campaign tests: synthetic clients stand in for live ones, the
// budget record and recordings land in temp dirs, and no network exists.

const usage = {
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
};

function instantConsultant(failFirstCallsFor?: {
  briefId: string;
  failures: { remaining: number };
}): ModelClient {
  return {
    executionProvenance: "synthetic",
    async extractFromIdea(input) {
      if (
        failFirstCallsFor &&
        input.projectName.includes(failFirstCallsFor.briefId) &&
        failFirstCallsFor.failures.remaining > 0
      ) {
        failFirstCallsFor.failures.remaining -= 1;
        throw new Error("injected transport failure");
      }
      return {
        payload: {
          statements: [{ kind: "fact", body: `Project ${input.projectName}.` }],
          concerns: [
            { code: "problem", coverage: "p" },
            { code: "user", coverage: "u" },
            { code: "workflow", coverage: "w" },
            { code: "success", coverage: "s" },
          ],
        },
        usage,
      };
    },
    async incrementalExtraction() {
      return { payload: { statements: [], concerns: [] }, usage };
    },
    async nextQuestion() {
      return {
        payload: {
          task: "next_question",
          payload: {
            candidates: [
              {
                body: "Anything else?",
                whySelected: "w",
                concernCodes: ["quality"],
                claimedScores: {
                  coreGap: 0,
                  sliceBounding: 0,
                  contradictionResolution: 0,
                },
                targetsContradictionIndexes: [],
              },
            ],
            contradictions: [],
            readyAdvice: { ready: true, why: "covered" },
          },
        },
        usage,
      };
    },
    async coachRecommendation() {
      throw new Error("never called");
    },
  };
}

const scriptedJudge: JudgeClient = {
  executionProvenance: "synthetic",
  async judge(input) {
    if (input.task === "judge-faithfulness") {
      return {
        payload: {
          verdicts: [{ index: 0, verdict: "grounded", why: "in script" }],
        },
        usage,
      };
    }
    return { payload: { score: 4, why: "fine" }, usage };
  },
};

function writeBrief(root: string, id: string): void {
  const dir = join(root, "briefs", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "brief.json"),
    JSON.stringify({
      id,
      projectName: `Instant ${id}`,
      idea: "An idea that is already fully framed.",
      domain: "test",
      traits: [],
      maxTurns: 12,
      fallback: { disposition: "unknown" },
      answers: { problem: ["p"], user: ["u"], workflow: ["w"], success: ["s"] },
    }),
    "utf8",
  );
  writeFileSync(
    join(dir, "labels.json"),
    JSON.stringify({
      briefId: id,
      status: "authored",
      requiredStatements: [],
      forbiddenContent: [],
      requiredConcerns: ["problem"],
      expectedTensions: [],
      stopTurn: 1,
      questionRankings: [],
    }),
    "utf8",
  );
}

const dirs: string[] = [];
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-capture-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function campaignInput(root: string, overrides: Record<string, unknown> = {}) {
  return {
    briefsDir: join(root, "briefs"),
    recordingsDir: join(root, "recordings"),
    calibrationDir: join(root, "calibration"),
    budgetPath: join(root, "budget.jsonl"),
    runId: "run-one",
    consultant: instantConsultant(),
    judge: scriptedJudge,
    gitCommit: "abc1234",
    models: { sonnet: "s", fable: "f" },
    promptVersionNote: "test",
    perBriefConsultantCapMicrocents: 150_000_000,
    perBriefJudgeCapMicrocents: 50_000_000,
    log: () => {},
    ...overrides,
  };
}

describe("capture campaign", () => {
  test("refuses to start without a budget record — absent is not authorization", async () => {
    const root = tempRoot();
    writeBrief(root, "alpha");
    await expect(runCaptureCampaign(campaignInput(root))).rejects.toThrow(
      /not fresh authorization/,
    );
  });

  test("captures every brief, settles spend, finalizes the run, and the run replays", async () => {
    const root = tempRoot();
    writeBrief(root, "alpha");
    writeBrief(root, "beta");
    initializeBudget(join(root, "budget.jsonl"), {
      capMicrocents: 1_500_000_000,
      note: "test",
    });

    const result = await runCaptureCampaign(campaignInput(root));
    expect(result.completedBriefIds).toEqual(["alpha", "beta"]);
    expect(result.finalized).toBe(true);
    expect(result.halted).toBeNull();

    const budget = readBudget(join(root, "budget.jsonl"));
    expect(budget.settledActualMicrocents).toBeGreaterThan(0);
    expect(budget.judgeSettledMicrocents).toBeGreaterThan(0);
    expect(budget.unresolvedReservationMicrocents).toBe(0);

    // Calibration templates and companions exist for both briefs.
    expect(
      existsSync(join(root, "calibration", "run-one", "alpha.json")),
    ).toBe(true);
    expect(
      existsSync(
        join(root, "calibration", "run-one", "alpha.transcript.md"),
      ),
    ).toBe(true);

    // The finalized run loads with verified hashes and replays offline.
    const run = loadRun(join(root, "recordings"), "run-one");
    const corpus = JSON.parse(
      readFileSync(join(root, "briefs", "alpha", "brief.json"), "utf8"),
    );
    const transcript = await replayBriefAgainstRun({
      brief: corpus,
      run,
    });
    expect(transcript.outcome).toBe("stopped");
  });

  test("a second invocation skips completed briefs instead of re-running them", async () => {
    const root = tempRoot();
    writeBrief(root, "alpha");
    initializeBudget(join(root, "budget.jsonl"), {
      capMicrocents: 1_500_000_000,
      note: "test",
    });
    await runCaptureCampaign(campaignInput(root));
    const settledAfterFirst = readBudget(
      join(root, "budget.jsonl"),
    ).settledActualMicrocents;

    const second = await runCaptureCampaign(campaignInput(root));
    expect(second.skippedExistingBriefIds).toEqual(["alpha"]);
    expect(second.completedBriefIds).toEqual([]);
    // No new spend on skipped briefs.
    expect(
      readBudget(join(root, "budget.jsonl")).settledActualMicrocents,
    ).toBe(settledAfterFirst);
  });

  test("one failure retries from scratch; the retry can complete the brief", async () => {
    const root = tempRoot();
    writeBrief(root, "alpha");
    initializeBudget(join(root, "budget.jsonl"), {
      capMicrocents: 1_500_000_000,
      note: "test",
    });
    const result = await runCaptureCampaign(
      campaignInput(root, {
        consultant: instantConsultant({
          briefId: "alpha",
          failures: { remaining: 1 },
        }),
      }),
    );
    expect(result.completedBriefIds).toEqual(["alpha"]);
    expect(result.finalized).toBe(true);
    // The failed attempt's spend is still on the record as a transport
    // reservation held at its estimate.
    expect(
      readBudget(join(root, "budget.jsonl"))
        .unresolvedReservationMicrocents,
    ).toBeGreaterThan(0);
  });

  test("two consecutive failures on one brief halt the pass without finalizing", async () => {
    const root = tempRoot();
    writeBrief(root, "alpha");
    writeBrief(root, "beta");
    initializeBudget(join(root, "budget.jsonl"), {
      capMicrocents: 1_500_000_000,
      note: "test",
    });
    const result = await runCaptureCampaign(
      campaignInput(root, {
        consultant: instantConsultant({
          briefId: "alpha",
          failures: { remaining: 2 },
        }),
      }),
    );
    expect(result.halted).toBe("alpha");
    expect(result.finalized).toBe(false);
    // No partial recording was written for the failed brief.
    expect(
      existsSync(
        join(root, "recordings", "run-one", "alpha", "consultation.jsonl"),
      ),
    ).toBe(false);
    // The halt stops the whole pass: beta was never attempted.
    expect(result.completedBriefIds).toEqual([]);
  });

  test("a brief is refused when the per-brief caps no longer fit the remaining budget", async () => {
    const root = tempRoot();
    writeBrief(root, "alpha");
    initializeBudget(join(root, "budget.jsonl"), {
      capMicrocents: 1_000, // far below the per-brief caps
      note: "test",
    });
    const result = await runCaptureCampaign(campaignInput(root));
    expect(result.completedBriefIds).toEqual([]);
    expect(result.incompleteBriefIds).toEqual(["alpha"]);
    expect(result.finalized).toBe(false);
  });
});
