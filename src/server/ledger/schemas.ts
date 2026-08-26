import { z } from "zod";
import { modelCatalog, type ModelAlias } from "../model/config";

export const statementKindSchema = z.enum([
  "fact",
  "decision",
  "hypothesis",
  "unknown",
  "deferred",
]);

export const reviewStatusSchema = z.enum(["proposed", "approved", "rejected"]);

export const provenanceSourceSchema = z.enum(["user", "model-inference"]);

export const concernCodeSchema = z.enum([
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

export const proposeStatementSchema = z.object({
  sessionId: z.string().min(1),
  kind: statementKindSchema,
  body: z.string().min(1),
  provenanceSource: provenanceSourceSchema,
  modelCallId: z.string().min(1).optional(),
});

export const proposeConcernSchema = z.object({
  sessionId: z.string().min(1),
  code: concernCodeSchema,
  coverage: z.string().min(1),
  provenanceSource: provenanceSourceSchema,
  modelCallId: z.string().min(1).optional(),
});

export const extractionOutputSchema = z.object({
  statements: z
    .array(
      z.object({
        kind: statementKindSchema,
        body: z.string().min(1),
      }),
    )
    .min(1),
  concerns: z.array(
    z.object({
      code: concernCodeSchema,
      coverage: z.string().min(1),
    }),
  ),
});

export const nextQuestionOutputSchema = z.object({
  body: z.string().min(1),
  whySelected: z.string().min(1),
});

export const proposeQuestionSchema = z.object({
  sessionId: z.string().min(1),
  body: z.string().min(1),
  whySelected: z.string().min(1),
  provenanceSource: provenanceSourceSchema,
  modelCallId: z.string().min(1).optional(),
});

export const questionDispositionSchema = z.enum([
  "answered",
  "unknown",
  "deferred",
]);

export const resolveQuestionSchema = z
  .object({
    questionId: z.string().min(1),
    disposition: questionDispositionSchema,
    body: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.disposition === "answered" && value.body.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "An answered question needs a non-empty answer",
        path: ["body"],
      });
    }
  });

export const coachConfidenceSchema = z.enum(["low", "medium", "high"]);

// The coach boundary must state how much to trust the advice and what
// observation would falsify it; a payload without a falsifier — or padded
// with fields outside the contract — is rejected wholesale like any other
// invalid model output. Required strings are trimmed before the non-empty
// check, so whitespace-only values fail too.
const coachField = z.string().trim().min(1);

export const coachOutputSchema = z.strictObject({
  recommendation: coachField,
  whyNow: coachField,
  technique: coachField,
  tradeoffs: coachField,
  gotcha: coachField,
  confidence: coachConfidenceSchema,
  evidenceWouldChange: coachField,
});

export const proposeCoachNoteSchema = coachOutputSchema.extend({
  sessionId: z.string().min(1),
  questionId: z.string().min(1).optional(),
  provenanceSource: provenanceSourceSchema,
  modelCallId: z.string().min(1).optional(),
});

export const coachNoteIdSchema = z.object({
  coachNoteId: z.string().min(1),
});

export const statementIdSchema = z.object({
  statementId: z.string().min(1),
});

export const editStatementSchema = z.object({
  statementId: z.string().min(1),
  body: z.string().min(1),
});

export const concernIdSchema = z.object({
  concernId: z.string().min(1),
});

export const editConcernSchema = z.object({
  concernId: z.string().min(1),
  coverage: z.string().min(1),
});

export const modelAliasSchema = z.enum(
  Object.keys(modelCatalog) as [ModelAlias, ...ModelAlias[]],
);

// How a model payload was produced: synthesized locally by the stub, replayed
// from a fixture, or returned by a live API call. Orthogonal to the
// provenance_source (who asserted content) recorded on ledger rows.
export const modelExecutionProvenanceSchema = z.enum([
  "synthetic",
  "recorded",
  "live",
]);

export const recordModelCallSchema = z.object({
  sessionId: z.string().min(1),
  modelAlias: modelAliasSchema,
  executionProvenance: modelExecutionProvenanceSchema,
  estimatedCostCents: z.number().int().min(0),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
  confirmedOverCap: z.boolean().optional(),
});

export type ProposeStatementInput = z.infer<typeof proposeStatementSchema>;
export type CoachConfidence = z.infer<typeof coachConfidenceSchema>;
export type CoachOutput = z.infer<typeof coachOutputSchema>;
export type ProposeCoachNoteInput = z.infer<typeof proposeCoachNoteSchema>;
export type EditStatementInput = z.infer<typeof editStatementSchema>;
export type EditConcernInput = z.infer<typeof editConcernSchema>;
export type RecordModelCallInput = z.infer<typeof recordModelCallSchema>;
export type ModelExecutionProvenance = z.infer<
  typeof modelExecutionProvenanceSchema
>;
export type ProposeConcernInput = z.infer<typeof proposeConcernSchema>;
export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;
export type NextQuestionOutput = z.infer<typeof nextQuestionOutputSchema>;
export type ProposeQuestionInput = z.infer<typeof proposeQuestionSchema>;
export type ResolveQuestionInput = z.infer<typeof resolveQuestionSchema>;
export type QuestionDisposition = z.infer<typeof questionDispositionSchema>;
export type StatementKind = z.infer<typeof statementKindSchema>;
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
