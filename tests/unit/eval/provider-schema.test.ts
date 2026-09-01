import { describe, expect, test } from "vitest";
import { briefSchema } from "../../../src/eval/corpus-schemas";
import {
  describeFaithfulnessRequest,
  describePairwiseRequest,
  describeSufficiencyRequest,
  describeUsefulnessRequest,
} from "../../../src/eval/judge";
import type { ReplayTranscript } from "../../../src/eval/replay";
import * as promptModule from "../../../src/server/model/prompt";
import { toWireSchema } from "../../../src/server/model/wire-schema";

// Provider-schema compatibility: the structured-output validator supports
// only a subset of JSON Schema. This was evidenced live twice on 2026-08-31
// — maxItems, then integer minimum/maximum, each failed every call at the
// transport boundary while spending real budget. Every API-facing output
// schema, consultant and judge alike, is scanned for the unsupported
// keywords; the full constraints live in the prompt contract text and the
// Zod gates, and toWireSchema strips them centrally.

const UNSUPPORTED_KEYWORDS = [
  "maxItems",
  "minimum",
  "maximum",
  "multipleOf",
  "minLength",
  "maxLength",
];

// Property-name aware, like the transformer: keys under "properties" are
// field names and are not keyword positions.
function findViolations(value: unknown, path: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findViolations(entry, `${path}[${index}]`),
    );
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  const found: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "properties" && child !== null && typeof child === "object") {
      for (const [name, fieldSchema] of Object.entries(
        child as Record<string, unknown>,
      )) {
        found.push(...findViolations(fieldSchema, `${path}.properties.${name}`));
      }
      continue;
    }
    if (UNSUPPORTED_KEYWORDS.includes(key)) {
      found.push(`${path}.${key}`);
    }
    if (key === "minItems" && typeof child === "number" && child > 1) {
      found.push(`${path}.minItems=${child}`);
    }
    found.push(...findViolations(child, `${path}.${key}`));
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

// Consultant formats are DISCOVERED, not listed: every export of prompt.ts
// whose name ends in OutputFormat is scanned, so a future format constant
// cannot silently bypass the scanner by being forgotten here. Judge schemas
// are reached through their describe* builders; a new judge task must add
// its builder below (the exhaustive-dimension checks in judge tests make a
// silently unscanned judge task unlikely to survive review).
function apiFacingSchemas(): { name: string; schema: unknown }[] {
  const consultantFormats = Object.entries(promptModule)
    .filter(([name]) => name.endsWith("OutputFormat"))
    .map(([name, schema]) => ({ name: `prompt.${name}`, schema }));
  return [
    ...consultantFormats,
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
  test("no API-facing schema carries unsupported keywords or minItems above 1", () => {
    for (const { name, schema } of apiFacingSchemas()) {
      expect(findViolations(schema, name)).toEqual([]);
    }
  });

  test("the scanner detects every keyword it hunts", () => {
    const probe = {
      schema: {
        maxItems: 3,
        minItems: 2,
        items: {
          minimum: 0,
          maximum: 5,
          multipleOf: 1,
          minLength: 1,
          maxLength: 9,
        },
      },
    };
    expect(findViolations(probe, "probe")).toHaveLength(7);
  });
});

describe("toWireSchema transformation", () => {
  test("strips every unsupported keyword and clamps minItems to 1", () => {
    const wire = toWireSchema({
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          score: { type: "integer", minimum: 1, maximum: 5 },
          body: { type: "string", minLength: 1, maxLength: 200 },
        },
        required: ["score", "body"],
        additionalProperties: false,
      },
    }) as Record<string, unknown>;
    expect(findViolations(wire, "wire")).toEqual([]);
    expect(wire["minItems"]).toBe(1);
    const items = wire["items"] as {
      properties: Record<string, Record<string, unknown>>;
      required: string[];
    };
    // Supported structure survives untouched.
    expect(items.properties["score"]).toEqual({ type: "integer" });
    expect(items.required).toEqual(["score", "body"]);
  });

  test("a field literally named after a keyword survives; only its schema is cleaned", () => {
    const wire = toWireSchema({
      type: "object",
      properties: {
        minimum: { type: "integer", minimum: 0 },
        maxLength: { type: "string", minLength: 1 },
      },
      required: ["minimum", "maxLength"],
    }) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(wire.properties).sort()).toEqual([
      "maxLength",
      "minimum",
    ]);
    expect(wire.properties["minimum"]).toEqual({ type: "integer" });
    expect(wire.required).toEqual(["minimum", "maxLength"]);
  });

  test("multipleOf is stripped with the other numeric keywords", () => {
    const wire = toWireSchema({
      type: "object",
      properties: { count: { type: "integer", multipleOf: 5, minimum: 0 } },
      required: ["count"],
    }) as { properties: Record<string, unknown> };
    expect(wire.properties["count"]).toEqual({ type: "integer" });
  });

  test("a keyword on neither list fails locally, never reaching the API", () => {
    expect(() =>
      toWireSchema({ type: "string", pattern: "^[a-z]+$" }),
    ).toThrow(/neither known-supported nor known-stripped/);
  });

  test("enums and anyOf survive untouched", () => {
    const wire = toWireSchema({
      anyOf: [
        { type: "string", enum: ["a", "b"], minLength: 1 },
        { type: "integer", minimum: 0 },
      ],
    }) as { anyOf: Record<string, unknown>[] };
    expect(wire.anyOf[0]).toEqual({ type: "string", enum: ["a", "b"] });
    expect(wire.anyOf[1]).toEqual({ type: "integer" });
  });
});
