import { describe, expect, test } from "vitest";
import type {
  AdaptiveNextQuestionOutput,
  QuestionCandidateOutput,
} from "../../../src/server/ledger/schemas";
import {
  rankCandidates,
  rubricExplanation,
  scoreCandidate,
} from "../../../src/server/model/rubric";

function candidate(
  overrides: Partial<QuestionCandidateOutput>,
): QuestionCandidateOutput {
  return {
    body: "A question?",
    whySelected: "A reason.",
    concernCodes: ["problem"],
    claimedScores: { coreGap: 0, sliceBounding: 0, contradictionResolution: 0 },
    targetsContradictionIndexes: [],
    ...overrides,
  };
}

function payload(
  candidates: QuestionCandidateOutput[],
  contradictionCount = 0,
): AdaptiveNextQuestionOutput {
  return {
    candidates,
    contradictions: Array.from({ length: contradictionCount }, (_, i) => ({
      summary: `Tension ${i}`,
      citedStatementIds: ["st-a", "st-b"],
    })),
    readyAdvice: { ready: false, why: "advisory" },
  };
}

describe("scoreCandidate", () => {
  test("a missing core code scores 3 regardless of the claim", () => {
    const scores = scoreCandidate(
      candidate({
        concernCodes: ["user"],
        claimedScores: { coreGap: 0, sliceBounding: 1, contradictionResolution: 3 },
      }),
      { approvedConcernCodes: new Set(["problem"]) },
    );
    expect(scores.effectiveCoreGap).toBe(3);
    // Claimed contradictionResolution is discarded: no targets means 0.
    expect(scores.effectiveContradiction).toBe(0);
    expect(scores.effectiveSliceBounding).toBe(1);
    expect(scores.effectiveTotal).toBe(4);
  });

  test("a missing optional code scores 1; full coverage scores 0", () => {
    const optional = scoreCandidate(candidate({ concernCodes: ["data"] }), {
      approvedConcernCodes: new Set(["problem", "user"]),
    });
    expect(optional.effectiveCoreGap).toBe(1);

    const covered = scoreCandidate(candidate({ concernCodes: ["problem"] }), {
      approvedConcernCodes: new Set(["problem"]),
    });
    expect(covered.effectiveCoreGap).toBe(0);
  });

  test("targeting an open contradiction scores 3, otherwise 0", () => {
    const targeting = scoreCandidate(
      candidate({ targetsContradictionIndexes: [0] }),
      { approvedConcernCodes: new Set(["problem"]) },
    );
    expect(targeting.effectiveContradiction).toBe(3);
  });
});

describe("rankCandidates", () => {
  test("brief A: the rubric prefers a missing core code over the model's first pick", () => {
    // Approved: problem and success. Missing core: user, workflow.
    const ranked = rankCandidates(
      payload([
        candidate({
          concernCodes: ["data"],
          claimedScores: { coreGap: 3, sliceBounding: 3, contradictionResolution: 0 },
        }),
        candidate({
          concernCodes: ["user"],
          claimedScores: { coreGap: 1, sliceBounding: 2, contradictionResolution: 0 },
        }),
      ]),
      { approvedConcernCodes: new Set(["problem", "success"]) },
    );

    // Model rank 1 claimed a core gap it does not have (1+3=4); the real core
    // gap candidate wins (3+2=5).
    expect(ranked[0]?.modelRank).toBe(2);
    expect(ranked[0]?.rubricRank).toBe(1);
    expect(ranked[1]?.modelRank).toBe(1);
  });

  test("brief B: with all cores covered, highest claimed sliceBounding wins with documented tie-breaks", () => {
    const allCovered = new Set([
      "problem",
      "user",
      "workflow",
      "data",
      "safety",
      "quality",
      "operations",
      "constraints",
      "non-goals",
      "success",
    ]);
    const ranked = rankCandidates(
      payload([
        candidate({
          body: "B1",
          concernCodes: ["quality"],
          claimedScores: { coreGap: 0, sliceBounding: 2, contradictionResolution: 0 },
        }),
        candidate({
          body: "B2",
          concernCodes: ["data"],
          claimedScores: { coreGap: 0, sliceBounding: 3, contradictionResolution: 0 },
        }),
        candidate({
          body: "B3",
          concernCodes: ["safety"],
          claimedScores: { coreGap: 0, sliceBounding: 2, contradictionResolution: 0 },
        }),
      ]),
      { approvedConcernCodes: allCovered },
    );

    expect(ranked[0]?.candidate.body).toBe("B2");
    // Tie at 2 between B1 (quality) and B3 (safety): ontology order puts
    // safety before quality.
    expect(ranked[1]?.candidate.body).toBe("B3");
    expect(ranked[2]?.candidate.body).toBe("B1");
  });

  test("brief C: targeting an open contradiction beats a higher slice-bounding claim", () => {
    const ranked = rankCandidates(
      payload(
        [
          candidate({
            body: "High bounding, no target",
            concernCodes: ["data"],
            claimedScores: { coreGap: 0, sliceBounding: 3, contradictionResolution: 0 },
          }),
          candidate({
            body: "Targets the tension",
            concernCodes: ["data"],
            claimedScores: { coreGap: 0, sliceBounding: 1, contradictionResolution: 0 },
            targetsContradictionIndexes: [0],
          }),
        ],
        1,
      ),
      { approvedConcernCodes: new Set(["problem", "user", "workflow", "success", "data"]) },
    );

    expect(ranked[0]?.candidate.body).toBe("Targets the tension");
  });

  test("payload-index tie-break is the final resort and is never random", () => {
    const ranked = rankCandidates(
      payload([
        candidate({ body: "first", concernCodes: ["data"] }),
        candidate({ body: "second", concernCodes: ["data"] }),
      ]),
      { approvedConcernCodes: new Set(["problem", "user", "workflow", "success", "data"]) },
    );
    expect(ranked[0]?.candidate.body).toBe("first");
    expect(ranked[1]?.candidate.body).toBe("second");
  });

  test("the checkpoint exercise: claimed scores cannot move the rubric", () => {
    // Approved: problem, success. Open contradiction at index 0.
    const ranked = rankCandidates(
      payload(
        [
          candidate({
            body: "C1",
            concernCodes: ["data"],
            claimedScores: { coreGap: 3, sliceBounding: 3, contradictionResolution: 2 },
          }),
          candidate({
            body: "C2",
            concernCodes: ["user"],
            claimedScores: { coreGap: 1, sliceBounding: 1, contradictionResolution: 0 },
          }),
          candidate({
            body: "C3",
            concernCodes: ["success"],
            claimedScores: { coreGap: 0, sliceBounding: 2, contradictionResolution: 0 },
            targetsContradictionIndexes: [0],
          }),
        ],
        1,
      ),
      { approvedConcernCodes: new Set(["problem", "success"]) },
    );

    expect(ranked.map((entry) => entry.candidate.body)).toStrictEqual([
      "C3",
      "C2",
      "C1",
    ]);
    expect(ranked[0]?.scores.effectiveTotal).toBe(5);
    expect(ranked[1]?.scores.effectiveTotal).toBe(4);
    expect(ranked[2]?.scores.effectiveTotal).toBe(4);
  });
});

describe("rubricExplanation", () => {
  test("names the effective scores and both ranks", () => {
    const ranked = rankCandidates(
      payload([candidate({ concernCodes: ["user"] })]),
      { approvedConcernCodes: new Set() },
    );
    const text = rubricExplanation(ranked[0]!);
    expect(text).toContain("effective total 3/9");
    expect(text).toContain("core gap 3");
    expect(text).toContain("Model ranked it #1");
  });
});
