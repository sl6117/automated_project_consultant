import { describe, expect, test } from "vitest";
import { briefSchema } from "../../../src/eval/corpus-schemas";
import type { JudgeClient } from "../../../src/eval/judge-client";
import { evaluatePairwise } from "../../../src/eval/pairwise";
import type { ReplayTranscript } from "../../../src/eval/replay";

const brief = briefSchema.parse({
  id: "pairwise-brief",
  projectName: "Pair",
  idea: "An idea compared across two runs.",
  domain: "test",
  traits: [],
  maxTurns: 12,
  fallback: { disposition: "unknown" },
  answers: { problem: ["p"], user: ["u"], workflow: ["w"], success: ["s"] },
});

function transcript(marker: string): ReplayTranscript {
  return {
    briefId: "pairwise-brief",
    outcome: "stopped",
    turns: [],
    stopOfferedAtTurn: 1,
    coreCoveredAtTurn: 0,
    framedAt: null,
    approvedStatements: [{ kind: "fact", body: `Statement from ${marker}.` }],
    approvedConcernCodes: [],
    tensionsRaisedTotal: 0,
    artifacts: [],
    attemptOutcomes: [],
    failureDetail: null,
  };
}

// A content-aware judge: prefers whichever transcript contains "run-a" for
// every dimension, regardless of presentation order.
const contentJudge: JudgeClient = {
  executionProvenance: "synthetic",
  async judge(input) {
    const content = input.request.messages[0]!.content;
    const firstBlock = content.slice(
      content.indexOf("--- Transcript 1 ---"),
      content.indexOf("--- Transcript 2 ---"),
    );
    const winner = firstBlock.includes("run-a") ? "1" : "2";
    return {
      payload: {
        picks: [
          { dimension: "faithfulness", winner, why: "w" },
          { dimension: "usefulness", winner, why: "w" },
          { dimension: "sufficiency", winner, why: "w" },
        ],
      },
      usage: null,
    };
  },
};

// A position-biased judge: always prefers whatever was shown first.
const firstPositionJudge: JudgeClient = {
  executionProvenance: "synthetic",
  async judge() {
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
  },
};

describe("pairwise comparison", () => {
  test("a content-consistent pick across both orders yields a verdict", async () => {
    const result = await evaluatePairwise({
      brief,
      a: transcript("run-a"),
      b: transcript("run-b"),
      aPassesDeterministic: true,
      bPassesDeterministic: true,
      client: contentJudge,
    });
    expect(result.positionBiasedDimensions).toBe(0);
    for (const verdict of result.verdicts) {
      expect(verdict.verdict).toBe("a");
      expect(verdict.deterministicDisagreement).toBe(false);
    }
  });

  test("a judge that always picks position 1 is flagged as position-biased", async () => {
    const result = await evaluatePairwise({
      brief,
      a: transcript("run-a"),
      b: transcript("run-b"),
      aPassesDeterministic: true,
      bPassesDeterministic: true,
      client: firstPositionJudge,
    });
    expect(result.positionBiasedDimensions).toBe(3);
    for (const verdict of result.verdicts) {
      expect(verdict.verdict).toBe("position-biased");
    }
  });

  test("preferring the deterministically failing side is flagged, not averaged away", async () => {
    const result = await evaluatePairwise({
      brief,
      a: transcript("run-a"),
      b: transcript("run-b"),
      aPassesDeterministic: false,
      bPassesDeterministic: true,
      client: contentJudge,
    });
    for (const verdict of result.verdicts) {
      expect(verdict.verdict).toBe("a");
      expect(verdict.deterministicDisagreement).toBe(true);
    }
  });
});
