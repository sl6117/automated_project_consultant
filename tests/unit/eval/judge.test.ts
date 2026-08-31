import { describe, expect, test } from "vitest";
import { briefSchema, labelsSchema } from "../../../src/eval/corpus-schemas";
import {
  describeFaithfulnessRequest,
  describePairwiseRequest,
  describeUsefulnessRequest,
  JudgeValidationError,
  parseFaithfulness,
  parsePairwise,
  parseUsefulness,
} from "../../../src/eval/judge";
import {
  createCapturingJudgeClient,
  createReplayJudgeClient,
  hashJudgeRequest,
  JudgeRecordingMissError,
  type JudgeClient,
} from "../../../src/eval/judge-client";
import { judgeTranscript } from "../../../src/eval/judge-run";
import type { RecordingEntry } from "../../../src/eval/recordings";
import type { ReplayTranscript } from "../../../src/eval/replay";

const brief = briefSchema.parse({
  id: "judge-brief",
  projectName: "Judged",
  idea: "An idea under judgement.",
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
});

const labels = labelsSchema.parse({
  briefId: "judge-brief",
  status: "authored",
  requiredStatements: [],
  forbiddenContent: [],
  requiredConcerns: ["problem"],
  expectedTensions: [],
  stopTurn: null,
  questionRankings: [
    { turn: 1, preferredCodes: ["success"] },
    { turn: 9, preferredCodes: ["data"] },
  ],
});

function transcript(): ReplayTranscript {
  return {
    briefId: "judge-brief",
    outcome: "stopped",
    turns: [
      {
        turn: 1,
        questionBody: "What does success look like?",
        concernCodes: ["success"],
        answerDisposition: "answered",
        answerBody: "s",
        tensionsRaised: [],
      },
    ],
    stopOfferedAtTurn: 2,
    coreCoveredAtTurn: 1,
    framedAt: "2026-08-31T00:00:00Z",
    approvedStatements: [
      { kind: "fact", body: "Grounded statement." },
      { kind: "fact", body: "Another statement." },
    ],
    approvedConcernCodes: ["problem", "user", "workflow", "success"],
    tensionsRaisedTotal: 0,
    artifacts: [{ filename: "SPEC.md", body: "# Spec" }],
    attemptOutcomes: [],
    failureDetail: null,
  };
}

// A deterministic scripted judge: statement index 1 is invented, every score
// is 4, pairwise always picks presentation position 1.
const scriptedJudge: JudgeClient = {
  executionProvenance: "synthetic",
  async judge(input) {
    if (input.task === "judge-faithfulness") {
      return {
        payload: {
          verdicts: [
            { index: 0, verdict: "grounded", why: "in the script" },
            { index: 1, verdict: "invented", why: "not in the script" },
          ],
        },
        usage: null,
      };
    }
    if (input.task === "judge-pairwise") {
      return {
        payload: {
          picks: [
            { dimension: "faithfulness", winner: "1", why: "w" },
            { dimension: "usefulness", winner: "1", why: "w" },
            { dimension: "sufficiency", winner: "1", why: "w" },
          ],
        },
        usage: null,
      };
    }
    return { payload: { score: 4, why: "reasonable" }, usage: null };
  },
};

describe("judge validation gates", () => {
  test("faithfulness must cover every statement exactly once", () => {
    expect(() =>
      parseFaithfulness(
        { verdicts: [{ index: 0, verdict: "grounded", why: "w" }] },
        { statementCount: 2 },
      ),
    ).toThrow(JudgeValidationError);
    expect(() =>
      parseFaithfulness(
        {
          verdicts: [
            { index: 0, verdict: "grounded", why: "w" },
            { index: 0, verdict: "invented", why: "w" },
          ],
        },
        { statementCount: 2 },
      ),
    ).toThrow(/Duplicate/);
    expect(() =>
      parseFaithfulness(
        {
          verdicts: [
            { index: 0, verdict: "grounded", why: "w" },
            { index: 5, verdict: "invented", why: "w" },
          ],
        },
        { statementCount: 2 },
      ),
    ).toThrow(/out of range/);
  });

  test("scores outside 1-5 are rejected", () => {
    expect(() => parseUsefulness({ score: 6, why: "w" })).toThrow(
      JudgeValidationError,
    );
    expect(() => parseUsefulness({ score: 0, why: "w" })).toThrow(
      JudgeValidationError,
    );
  });

  test("pairwise picks must cover each dimension exactly once", () => {
    expect(() =>
      parsePairwise({
        picks: [
          { dimension: "faithfulness", winner: "1", why: "w" },
          { dimension: "faithfulness", winner: "2", why: "w" },
          { dimension: "sufficiency", winner: "1", why: "w" },
        ],
      }),
    ).toThrow(/exactly once/);
  });
});

describe("judge prompts", () => {
  test("judge requests contain no ledger UUIDs, only indexes", () => {
    const request = describeFaithfulnessRequest({
      brief,
      transcript: transcript(),
    });
    const text = JSON.stringify(request);
    expect(text).toContain("[0]");
    expect(text).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );
  });

  test("identical inputs render byte-identical requests with equal hashes", () => {
    const first = describeUsefulnessRequest({
      brief,
      transcript: transcript(),
      turn: 1,
    });
    const second = describeUsefulnessRequest({
      brief,
      transcript: transcript(),
      turn: 1,
    });
    expect(hashJudgeRequest(first)).toBe(hashJudgeRequest(second));
  });

  test("swapping transcript presentation order changes the pairwise request", () => {
    const a = transcript();
    const b = { ...transcript(), outcome: "missed-stop" as const };
    const forward = describePairwiseRequest({ brief, first: a, second: b });
    const reversed = describePairwiseRequest({ brief, first: b, second: a });
    expect(hashJudgeRequest(forward)).not.toBe(hashJudgeRequest(reversed));
  });
});

describe("judge runner", () => {
  test("judges faithfulness, labeled turns present in the transcript, and sufficiency", async () => {
    const scores = await judgeTranscript({
      brief,
      transcript: transcript(),
      labels,
      client: scriptedJudge,
    });
    expect(scores.inventedStatementIndexes).toEqual([1]);
    expect(scores.statementCount).toBe(2);
    // Turn 9 is labeled but the transcript has no turn 9: skipped, no call.
    expect(scores.usefulnessByTurn).toEqual([
      { turn: 1, score: 4, why: "reasonable" },
    ]);
    expect(scores.minimumSufficiency.score).toBe(4);
  });

  test("judge calls capture and replay by exact hash, and a miss rejects", async () => {
    const entries: RecordingEntry[] = [];
    await judgeTranscript({
      brief,
      transcript: transcript(),
      labels,
      client: createCapturingJudgeClient(scriptedJudge, {
        record: (entry) => entries.push(entry),
      }),
    });
    expect(entries).toHaveLength(3);

    const run = {
      manifest: {} as never,
      entriesByHash: new Map(entries.map((entry) => [entry.requestHash, entry])),
      entriesByBrief: new Map([["judge-brief", entries]]),
    };
    const replayClient = createReplayJudgeClient(run);
    const replayed = await judgeTranscript({
      brief,
      transcript: transcript(),
      labels,
      client: replayClient,
    });
    expect(replayed.inventedStatementIndexes).toEqual([1]);
    expect(replayClient.misses).toHaveLength(0);

    // A changed transcript (one statement reworded) misses the hash.
    const changed = transcript();
    changed.approvedStatements[0]!.body = "Grounded statement, reworded.";
    await expect(
      judgeTranscript({
        brief,
        transcript: changed,
        labels,
        client: replayClient,
      }),
    ).rejects.toThrow(JudgeRecordingMissError);
    expect(replayClient.misses).toHaveLength(1);
  });
});
