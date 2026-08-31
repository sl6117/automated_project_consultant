import { describe, expect, test } from "vitest";
import { briefSchema } from "../../../src/eval/corpus-schemas";
import {
  describeFaithfulnessRequest,
  describePairwiseRequest,
  describeSufficiencyRequest,
  describeUsefulnessRequest,
} from "../../../src/eval/judge";
import type { ReplayTranscript } from "../../../src/eval/replay";
import {
  extractionOutputFormat,
  fableOutputFormat,
  incrementalExtractionOutputFormat,
} from "../../../src/server/model/prompt";

// Provider-schema compatibility: the structured-output validator rejects
// schemas containing keywords it does not support. This was evidenced live
// on 2026-08-31 — a next-question schema carrying maxItems failed every
// call at the transport boundary while spending real budget on retries.
// Every API-facing output schema, consultant and judge alike, is scanned
// here for the unsupported keywords; the equivalent constraints live in the
// prompt contract text and the Zod gates instead.

const UNSUPPORTED_KEYWORDS = ["maxItems"];

function findKeyword(value: unknown, keyword: string, path: string): string[] {
  if (value === null || typeof value !== "object") {
    return [];
  }
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === keyword) {
      found.push(`${path}.${key}`);
    }
    found.push(...findKeyword(child, keyword, `${path}.${key}`));
  }
  return found;
}

const brief = briefSchema.parse({
  id: "schema-brief",
  projectName: "S",
  idea: "an idea",
  domain: "test",
  traits: [],
  maxTurns: 12,
  fallback: { disposition: "unknown" },
  answers: { problem: ["p"], user: ["u"], workflow: ["w"], success: ["s"] },
});

const transcript: ReplayTranscript = {
  briefId: "schema-brief",
  outcome: "stopped",
  turns: [
    {
      turn: 1,
      questionBody: "Q?",
      concernCodes: ["success"],
      answerDisposition: "answered",
      answerBody: "a",
      tensionsRaised: [],
    },
  ],
  stopOfferedAtTurn: 2,
  coreCoveredAtTurn: 1,
  framedAt: null,
  approvedStatements: [{ kind: "fact", body: "A statement." }],
  approvedConcernCodes: [],
  tensionsRaisedTotal: 0,
  artifacts: [],
  attemptOutcomes: [],
  failureDetail: null,
};

function apiFacingSchemas(): { name: string; schema: unknown }[] {
  return [
    { name: "extraction", schema: extractionOutputFormat },
    { name: "incremental", schema: incrementalExtractionOutputFormat },
    { name: "fable (next-question + coach)", schema: fableOutputFormat },
    {
      name: "judge-faithfulness",
      schema: describeFaithfulnessRequest({ brief, transcript }).output_config,
    },
    {
      name: "judge-usefulness",
      schema: describeUsefulnessRequest({ brief, transcript, turn: 1 })
        .output_config,
    },
    {
      name: "judge-sufficiency",
      schema: describeSufficiencyRequest({ brief, transcript }).output_config,
    },
    {
      name: "judge-pairwise",
      schema: describePairwiseRequest({
        brief,
        first: transcript,
        second: transcript,
      }).output_config,
    },
  ];
}

describe("provider schema compatibility", () => {
  for (const keyword of UNSUPPORTED_KEYWORDS) {
    test(`no API-facing output schema contains ${keyword}`, () => {
      for (const { name, schema } of apiFacingSchemas()) {
        const hits = findKeyword(schema, keyword, name);
        expect(hits, `${name} carries unsupported ${keyword}`).toEqual([]);
      }
    });
  }

  test("the scanner itself detects the keyword when present", () => {
    const hits = findKeyword(
      { schema: { items: { maxItems: 3 } } },
      "maxItems",
      "probe",
    );
    expect(hits).toEqual(["probe.schema.items.maxItems"]);
  });
});
