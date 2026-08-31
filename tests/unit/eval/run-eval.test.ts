import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createCapturingModelClient } from "../../../src/eval/capture-client";
import { briefSchema } from "../../../src/eval/corpus-schemas";
import { writeRun, type RecordingEntry } from "../../../src/eval/recordings";
import { replayBrief } from "../../../src/eval/replay";
import { runEval } from "../../../src/eval/run-eval";
import { DEFAULT_THRESHOLDS } from "../../../src/eval/thresholds";
import type { ModelClient } from "../../../src/server/model/client";

// A minimal client whose consultation stops immediately: extraction covers
// all four core codes plus a fact, so the first ask yields the ready offer.
const instantClient: ModelClient = {
  executionProvenance: "synthetic",
  async extractFromIdea(input) {
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
      usage: {
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWrite5mTokens: 0,
        cacheWrite1hTokens: 0,
      },
    };
  },
  async incrementalExtraction() {
    return { payload: { statements: [], concerns: [] }, usage: null };
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
      usage: null,
    };
  },
  async coachRecommendation() {
    throw new Error("never called");
  },
};

const brief = {
  id: "instant-brief",
  projectName: "Instant",
  idea: "An idea that is already fully framed.",
  domain: "test",
  traits: [],
  maxTurns: 12,
  fallback: { disposition: "unknown" },
  answers: {
    problem: ["p"],
    user: ["u"],
    workflow: ["w"],
    success: ["s"],
  },
};

const authoredLabels = {
  briefId: "instant-brief",
  status: "authored",
  requiredStatements: [{ kind: "fact", mustMention: "Instant" }],
  forbiddenContent: [],
  requiredConcerns: ["problem", "user", "workflow", "success"],
  expectedTensions: [],
  stopTurn: 1,
  questionRankings: [],
};

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-cli-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function evalPaths(root: string) {
  mkdirSync(join(root, "reports"), { recursive: true });
  writeFileSync(
    join(root, "thresholds.json"),
    JSON.stringify(DEFAULT_THRESHOLDS),
    "utf8",
  );
  return {
    briefsDir: join(root, "briefs"),
    recordingsDir: join(root, "recordings"),
    calibrationDir: join(root, "calibration"),
    reportsDir: join(root, "reports"),
    thresholdsPath: join(root, "thresholds.json"),
    budgetPath: join(root, "budget.jsonl"),
  };
}

async function writeFixture(root: string): Promise<void> {
  const briefDir = join(root, "briefs", brief.id);
  mkdirSync(briefDir, { recursive: true });
  writeFileSync(join(briefDir, "brief.json"), JSON.stringify(brief), "utf8");
  writeFileSync(
    join(briefDir, "labels.json"),
    JSON.stringify(authoredLabels),
    "utf8",
  );

  const entries: RecordingEntry[] = [];
  await replayBrief({
    brief: briefSchema.parse(brief),
    client: createCapturingModelClient(instantClient, {
      record: (entry) => entries.push(entry),
    }),
  });
  writeRun(join(root, "recordings"), {
    manifest: {
      runId: "run-one",
      capturedAt: "2026-08-28T00:00:00Z",
      gitCommit: "abc1234",
      models: { sonnet: "s", fable: "f" },
      promptVersionNote: "test",
      briefIds: [brief.id],
    },
    briefs: [{ briefId: brief.id, entries }],
  });
}

describe("npm run eval command", () => {
  test("replays, scores, reports recorded cost, and exits zero on a passing corpus", async () => {
    const root = tempDir();
    await writeFixture(root);

    const lines: string[] = [];
    const { exitCode } = await runEval({
      ...evalPaths(root),
      log: (line) => lines.push(line),
    });

    expect(exitCode).toBe(0);
    expect(lines.join("\n")).toContain("pass  instant-brief");
    expect(lines.join("\n")).toContain("1/1 briefs pass");
    // Cost comes from the recorded usage, not the zero-cost replay.
    expect(lines.join("\n")).toMatch(/0\.00\d+ USD recorded/);
    // No baseline is designated yet; the comparison is skipped and noted.
    expect(lines.join("\n")).toContain("baseline comparison skipped");

    // Determinism: a second invocation logs byte-identical output.
    const again: string[] = [];
    await runEval({
      ...evalPaths(root),
      log: (line) => again.push(line),
    });
    expect(again).toStrictEqual(lines);
  });

  test("with no recorded runs it refuses with capture instructions, exit nonzero", async () => {
    const root = tempDir();
    mkdirSync(join(root, "briefs"), { recursive: true });

    const lines: string[] = [];
    const { exitCode } = await runEval({
      ...evalPaths(root),
      log: (line) => lines.push(line),
    });
    expect(exitCode).toBe(1);
    expect(lines.join("\n")).toContain("capture pass");
  });
});
