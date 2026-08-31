import { describe, expect, test } from "vitest";
import { labelsSchema } from "../../../src/eval/corpus-schemas";
import type { ReplayTranscript } from "../../../src/eval/replay";
import { scoreBrief, UnauthoredLabelsError } from "../../../src/eval/score";

function transcript(
  overrides: Partial<ReplayTranscript> = {},
): ReplayTranscript {
  return {
    briefId: "b",
    outcome: "stopped",
    turns: [
      {
        turn: 1,
        questionBody: "Q1?",
        concernCodes: ["success"],
        answerDisposition: "answered",
        answerBody: "a",
        tensionsRaised: [],
      },
    ],
    stopOfferedAtTurn: 2,
    coreCoveredAtTurn: 1,
    framedAt: "2026-08-28T00:00:00Z",
    approvedStatements: [
      { kind: "fact", body: "The shop uses a Windows laptop." },
    ],
    approvedConcernCodes: ["problem", "user", "workflow", "success"],
    tensionsRaisedTotal: 0,
    artifacts: [],
    attemptOutcomes: [{ alias: "sonnet", status: "succeeded" }],
    failureDetail: null,
    ...overrides,
  };
}

function labels(overrides: Record<string, unknown> = {}) {
  return labelsSchema.parse({
    briefId: "b",
    status: "authored",
    requiredStatements: [{ kind: "fact", mustMention: "Windows laptop" }],
    forbiddenContent: ["manager"],
    requiredConcerns: ["problem", "user", "workflow", "success"],
    expectedTensions: [],
    stopTurn: 2,
    questionRankings: [{ turn: 1, preferredCodes: ["success"] }],
    ...overrides,
  });
}

describe("deterministic scoring", () => {
  test("a clean transcript passes every dimension", () => {
    const score = scoreBrief(transcript(), labels());
    expect(score.pass).toBe(true);
    expect(score.dimensions.extractionCoverage.pass).toBe(true);
    expect(score.dimensions.stopCorrectness.pass).toBe(true);
  });

  test("template labels are refused, never scored", () => {
    expect(() =>
      scoreBrief(
        transcript(),
        labels({
          status: "template",
          requiredStatements: [],
          stopTurn: null,
          questionRankings: [],
          requiredConcerns: [],
          forbiddenContent: [],
        }),
      ),
    ).toThrow(UnauthoredLabelsError);
  });

  test("matching is case-insensitive substring on the statement body", () => {
    const score = scoreBrief(
      transcript({
        approvedStatements: [
          { kind: "fact", body: "It must run on the shop's WINDOWS LAPTOP." },
        ],
      }),
      labels(),
    );
    expect(score.dimensions.extractionCoverage.pass).toBe(true);
  });

  test("a right mention under the wrong kind fails coverage", () => {
    const score = scoreBrief(
      transcript({
        approvedStatements: [
          { kind: "hypothesis", body: "The shop uses a Windows laptop." },
        ],
      }),
      labels(),
    );
    expect(score.dimensions.extractionCoverage.pass).toBe(false);
    expect(score.pass).toBe(false);
  });

  test("forbidden content in an approved statement fails coverage", () => {
    const score = scoreBrief(
      transcript({
        approvedStatements: [
          { kind: "fact", body: "The shop uses a Windows laptop." },
          { kind: "fact", body: "The manager reviews orders." },
        ],
      }),
      labels(),
    );
    expect(score.dimensions.extractionCoverage.pass).toBe(false);
  });

  test("a stop offer before the labeled turn is premature", () => {
    const score = scoreBrief(
      transcript({ stopOfferedAtTurn: 1 }),
      labels({ stopTurn: 2 }),
    );
    expect(score.dimensions.stopCorrectness.pass).toBe(false);
    expect(score.dimensions.stopCorrectness.detail).toContain("premature");
  });

  test("no stop offer at all is a missed stop", () => {
    const score = scoreBrief(
      transcript({ outcome: "missed-stop", stopOfferedAtTurn: null }),
      labels(),
    );
    expect(score.dimensions.stopCorrectness.pass).toBe(false);
    expect(score.dimensions.stopCorrectness.detail).toContain("missed stop");
  });

  test("an unlabeled stop turn leaves the dimension inapplicable", () => {
    const score = scoreBrief(
      transcript({ stopOfferedAtTurn: null, outcome: "missed-stop" }),
      labels({ stopTurn: null }),
    );
    expect(score.dimensions.stopCorrectness.applicable).toBe(false);
    expect(score.pass).toBe(true);
  });

  test("a raised tension citing fewer than two statements fails contradiction handling", () => {
    const score = scoreBrief(
      transcript({
        tensionsRaisedTotal: 1,
        turns: [
          {
            turn: 1,
            questionBody: "Q1?",
            concernCodes: ["success"],
            answerDisposition: "answered",
            answerBody: "a",
            tensionsRaised: [
              { summary: "t", citedStatementIds: ["only-one-id"] },
            ],
          },
        ],
      }),
      labels(),
    );
    expect(score.dimensions.contradictionHandling.pass).toBe(false);
    expect(score.dimensions.contradictionHandling.detail).toContain(
      "fewer than two",
    );
  });

  test("fewer raised tensions than labeled fails contradiction handling", () => {
    const score = scoreBrief(
      transcript({ tensionsRaisedTotal: 0 }),
      labels({ expectedTensions: [{ summary: "a tension" }] }),
    );
    expect(score.dimensions.contradictionHandling.pass).toBe(false);
  });

  test("a validation-failed attempt is an automatic brief failure", () => {
    const score = scoreBrief(
      transcript({
        attemptOutcomes: [
          { alias: "sonnet", status: "succeeded" },
          { alias: "fable", status: "validation_failed" },
        ],
      }),
      labels(),
    );
    expect(score.dimensions.contractDiscipline.pass).toBe(false);
    expect(score.pass).toBe(false);
  });

  test("a labeled turn the consultant never targeted is an efficiency miss", () => {
    const score = scoreBrief(
      transcript({
        turns: [
          {
            turn: 1,
            questionBody: "Q1?",
            concernCodes: ["operations"],
            answerDisposition: "answered",
            answerBody: "a",
            tensionsRaised: [],
          },
        ],
      }),
      labels(),
    );
    expect(score.dimensions.questionEfficiency.pass).toBe(false);
    expect(score.dimensions.questionEfficiency.detail).toContain("miss");
  });
});
