import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ModelClient } from "../../../src/server/model/client";
import { briefSchema, labelsSchema } from "../../../src/eval/corpus-schemas";
import { createCapturingModelClient } from "../../../src/eval/capture-client";
import { loadRun, writeRun, type RecordingEntry } from "../../../src/eval/recordings";
import {
  replayBrief,
  replayBriefAgainstRun,
  type ReplayTranscript,
} from "../../../src/eval/replay";
import { RecordingMissError } from "../../../src/eval/replay-client";
import { scoreBrief } from "../../../src/eval/score";

// A deterministic scripted client rich enough to exercise the whole driver:
// extraction covers three core codes, the first ask targets the missing
// success code, the second ask raises a contradiction citing two approved
// statement ids (read dynamically from the structured inputs, like a real
// model would from the prompt), and the third ask finds the checklist
// passing, yielding the ready offer.
function createScriptedClient(): ModelClient {
  return {
    executionProvenance: "synthetic",
    async extractFromIdea(input) {
      return {
        payload: {
          statements: [
            { kind: "fact", body: `The project ${input.projectName} exists.` },
          ],
          concerns: [
            { code: "problem", coverage: "the stated pain" },
            { code: "user", coverage: "the named operator" },
            { code: "workflow", coverage: "the described path" },
          ],
        },
        usage: null,
      };
    },
    async incrementalExtraction(input) {
      return {
        payload: {
          statements: [{ kind: "decision", body: `Decided: ${input.answerBody}` }],
          concerns: input.answerBody.includes("success")
            ? [{ code: "success", coverage: "the stated evidence" }]
            : [],
        },
        usage: null,
      };
    },
    async nextQuestion(input) {
      const raiseTension =
        input.context.openContradictions.length === 0 &&
        input.context.resolvedQuestions.length === 1 &&
        input.approved.statements.length >= 2;
      return {
        payload: {
          task: "next_question",
          payload: {
            candidates: [
              {
                body:
                  input.context.missingCoreCodes.length > 0
                    ? "What does success look like?"
                    : "Anything else that matters?",
                whySelected: "scripted",
                concernCodes:
                  input.context.missingCoreCodes.length > 0
                    ? ["success"]
                    : ["quality"],
                claimedScores: {
                  coreGap: 3,
                  sliceBounding: 1,
                  contradictionResolution: 0,
                },
                targetsContradictionIndexes: [],
              },
            ],
            contradictions: raiseTension
              ? [
                  {
                    summary: "The first two statements pull apart.",
                    citedStatementIds: [
                      input.approved.statements[0]!.id,
                      input.approved.statements[1]!.id,
                    ],
                  },
                ]
              : [],
            readyAdvice: { ready: false, why: "scripted" },
          },
        },
        usage: null,
      };
    },
    async coachRecommendation() {
      throw new Error("The replay driver never requests coaching");
    },
  };
}

const brief = briefSchema.parse({
  id: "scripted-brief",
  projectName: "Scripted",
  idea: "A deterministic consultation for harness tests.",
  domain: "test",
  traits: [],
  maxTurns: 12,
  fallback: { disposition: "unknown" },
  answers: {
    problem: ["the problem answer"],
    user: ["the user answer"],
    workflow: ["the workflow answer"],
    success: ["the success answer we measure"],
  },
});

const labels = labelsSchema.parse({
  briefId: "scripted-brief",
  status: "authored",
  requiredStatements: [{ kind: "fact", mustMention: "Scripted" }],
  forbiddenContent: ["invented feature"],
  requiredConcerns: ["problem", "user", "workflow", "success"],
  expectedTensions: [{ summary: "The first two statements pull apart." }],
  stopTurn: 3,
  questionRankings: [{ turn: 1, preferredCodes: ["success"] }],
});

// citedStatementIds are freshly minted UUIDs in every replay; normalizing
// them to a count makes two replays comparable while still asserting the
// citations exist.
function normalized(transcript: ReplayTranscript): unknown {
  return {
    ...transcript,
    // Wall-clock only; determinism is about content and scores.
    framedAt: transcript.framedAt === null ? null : "(some timestamp)",
    turns: transcript.turns.map((turn) => ({
      ...turn,
      tensionsRaised: turn.tensionsRaised.map((tension) => ({
        summary: tension.summary,
        citedCount: tension.citedStatementIds.length,
      })),
    })),
  };
}

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "eval-replay-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function captureRun(dir: string): Promise<void> {
  const entries: RecordingEntry[] = [];
  const transcript = await replayBrief({
    brief,
    client: createCapturingModelClient(createScriptedClient(), {
      record: (entry) => entries.push(entry),
    }),
  });
  expect(transcript.outcome).toBe("stopped");
  writeRun(dir, {
    manifest: {
      runId: "test-run",
      capturedAt: "2026-08-28T00:00:00Z",
      gitCommit: "abc1234",
      models: { sonnet: "s", fable: "f" },
      promptVersionNote: "test",
      briefIds: [brief.id],
    },
    briefs: [{ briefId: brief.id, entries }],
  });
}

describe("capture and replay", () => {
  test("the scripted consultation stops with a raised tension and full coverage", async () => {
    const transcript = await replayBrief({
      brief,
      client: createScriptedClient(),
    });
    expect(transcript.outcome).toBe("stopped");
    expect(transcript.turns).toHaveLength(2);
    expect(transcript.stopOfferedAtTurn).toBe(3);
    expect(transcript.tensionsRaisedTotal).toBe(1);
    expect(transcript.coreCoveredAtTurn).toBe(1);
    expect(transcript.artifacts.length).toBeGreaterThan(0);

    const score = scoreBrief(transcript, labels);
    expect(score.pass).toBe(true);
  });

  test("replay from recordings reproduces the captured consultation deterministically", async () => {
    const dir = tempDir();
    await captureRun(dir);
    const run = loadRun(dir, "test-run");

    const first = await replayBriefAgainstRun({ brief, run });
    const second = await replayBriefAgainstRun({ brief, run });

    expect(first.outcome).toBe("stopped");
    // Two replays mint different UUIDs yet produce identical transcripts and
    // identical scores — the determinism the offline gate depends on.
    expect(normalized(first)).toStrictEqual(normalized(second));
    expect(scoreBrief(first, labels)).toStrictEqual(scoreBrief(second, labels));
    // The replayed tension cites statements that exist in the replay session,
    // so citation validation passed against fresh UUIDs.
    expect(first.tensionsRaisedTotal).toBe(1);
  });

  test("a changed brief misses every hash and rejects the run", async () => {
    const dir = tempDir();
    await captureRun(dir);
    const run = loadRun(dir, "test-run");

    const editedBrief = briefSchema.parse({
      ...brief,
      idea: "A deterministic consultation for harness tests, reworded.",
    });
    await expect(
      replayBriefAgainstRun({ brief: editedBrief, run }),
    ).rejects.toThrow(RecordingMissError);
  });

  test("reaching the max turn count ends as missed-stop, never a harness error", async () => {
    // The stub-like client below never proposes the missing success coverage,
    // so the checklist can never pass and the bound must end the replay.
    const stubborn: ModelClient = {
      ...createScriptedClient(),
      async incrementalExtraction(input) {
        return {
          payload: {
            statements: [
              { kind: "decision", body: `Decided: ${input.answerBody}` },
            ],
            concerns: [],
          },
          usage: null,
        };
      },
    };
    const bounded = briefSchema.parse({ ...brief, maxTurns: 3 });
    const transcript = await replayBrief({ brief: bounded, client: stubborn });
    expect(transcript.outcome).toBe("missed-stop");
    expect(transcript.turns).toHaveLength(3);
    expect(transcript.stopOfferedAtTurn).toBeNull();
  });
});
