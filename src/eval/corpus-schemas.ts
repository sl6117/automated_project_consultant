import { z } from "zod";
import {
  concernCodeSchema,
  statementKindSchema,
} from "../server/ledger/schemas";

// Phase 3 slice 1: schema validation for the evaluation corpus. Briefs are
// drafted by Claude and owner-reviewed; labels are owner-authored
// exclusively — these schemas check structure only, never content quality.

// Traits are self-declared per brief and verified against the spec's corpus
// quotas by the corpus test; the owner's review is what makes them honest.
export const briefTraitSchema = z.enum([
  "data-heavy",
  "safety-sensitive",
  "constraint-dominated",
  "vague",
  "secrets-content",
  "early-stop",
  "hard-coverage",
  "contradiction",
]);

// The persona's fallback when every code on a question is exhausted. Each
// brief must declare one explicitly; the harness refuses a brief without it.
export const personaFallbackSchema = z.discriminatedUnion("disposition", [
  z.strictObject({ disposition: z.literal("unknown") }),
  z.strictObject({
    disposition: z.literal("answered"),
    body: z.string().min(1),
  }),
]);

// Winnability is enforced structurally: every core code must carry at least
// one scripted entry, so any consultant that asks toward a core gap always
// has material to earn — an unwinnable brief cannot discriminate and is
// refused at validation time, not discovered at replay time.
export const CORE_BRIEF_CODES = [
  "problem",
  "user",
  "workflow",
  "success",
] as const;

export const briefSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case id required"),
    projectName: z.string().min(1),
    idea: z.string().min(1),
    domain: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case domain required"),
    traits: z.array(briefTraitSchema),
    maxTurns: z.number().int().min(1).max(30).default(12),
    fallback: personaFallbackSchema,
    // partialRecord: in Zod 4 a plain record over an enum key demands every
    // key; a brief scripts only the codes its persona knows about.
    answers: z.partialRecord(
      concernCodeSchema,
      z.array(z.string().min(1)).min(1),
    ),
  })
  .superRefine((brief, ctx) => {
    for (const code of CORE_BRIEF_CODES) {
      // The length check is unreachable while the answers arrays carry
      // .min(1); it stays as defense in depth should that ever be relaxed.
      if (!brief.answers[code] || brief.answers[code].length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `Brief ${brief.id} is not winnable: no scripted entry for core code ${code}`,
          path: ["answers", code],
        });
      }
    }
  });

// Label structure only — content quality stays the owner's judgement. status
// stays "template" until the owner authors the content and flips it to
// "authored"; scoring (slice 2+) refuses templates, and the schema refuses an
// "authored" label that demands no coverage at all.
export const labelsSchema = z
  .strictObject({
    briefId: z.string().min(1),
    status: z.enum(["template", "authored"]),
    instructions: z.string().optional(),
    requiredStatements: z.array(
      z.strictObject({
        kind: statementKindSchema,
        mustMention: z.string().min(1),
      }),
    ),
    forbiddenContent: z.array(z.string().min(1)),
    requiredConcerns: z.array(concernCodeSchema),
    expectedTensions: z.array(
      z.strictObject({
        summary: z.string().min(1),
      }),
    ),
    stopTurn: z.number().int().min(1).nullable(),
    questionRankings: z.array(
      z.strictObject({
        turn: z.number().int().min(1),
        preferredCodes: z.array(concernCodeSchema).min(1),
        note: z.string().optional(),
      }),
    ),
  })
  .superRefine((labels, ctx) => {
    // An authored label must demand some coverage; otherwise flipping the
    // status string alone would be indistinguishable from a template.
    if (labels.status === "authored" && labels.requiredConcerns.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `Labels for ${labels.briefId} claim "authored" but require no concern coverage`,
        path: ["requiredConcerns"],
      });
    }
  });

export type Brief = z.infer<typeof briefSchema>;
export type BriefLabels = z.infer<typeof labelsSchema>;
