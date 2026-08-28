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

// Both extraction payloads are strict at every level: unknown fields are a
// contract violation, not padding to drop silently — the Zod gate is the
// only validation for recorded and synthetic clients, where the live API's
// additionalProperties: false never runs.
const extractionStatementItemSchema = z.strictObject({
  kind: statementKindSchema,
  body: z.string().min(1),
});

const extractionConcernItemSchema = z.strictObject({
  code: concernCodeSchema,
  coverage: z.string().min(1),
});

export const extractionOutputSchema = z.strictObject({
  statements: z.array(extractionStatementItemSchema).min(1),
  concerns: z.array(extractionConcernItemSchema),
});

// Incremental extraction after an answer: unlike the initial extraction, BOTH
// arrays may be empty — an answer that adds nothing new is a valid outcome,
// and requiring content would pressure the model to fabricate. A valid empty
// payload persists nothing.
export const incrementalExtractionOutputSchema = z.strictObject({
  statements: z.array(extractionStatementItemSchema),
  concerns: z.array(extractionConcernItemSchema),
});

// Phase 2 adaptive next-question payload: candidates with claimed scores,
// cited contradictions, and advisory readiness. Claimed scores are stored for
// calibration comparison; ranking uses app-computed effective scores.
export const claimedScoreSchema = z.number().int().min(0).max(3);

export const questionCandidateOutputSchema = z.strictObject({
  body: z.string().min(1),
  whySelected: z.string().min(1),
  concernCodes: z.array(concernCodeSchema).min(1),
  claimedScores: z.strictObject({
    coreGap: claimedScoreSchema,
    sliceBounding: claimedScoreSchema,
    contradictionResolution: claimedScoreSchema,
  }),
  targetsContradictionIndexes: z.array(z.number().int().min(0)),
});

export const contradictionOutputSchema = z.strictObject({
  summary: z.string().min(1),
  citedStatementIds: z.array(z.string().min(1)).min(2),
});

export const adaptiveNextQuestionOutputSchema = z.strictObject({
  candidates: z.array(questionCandidateOutputSchema).min(1).max(5),
  contradictions: z.array(contradictionOutputSchema),
  readyAdvice: z.strictObject({
    ready: z.boolean(),
    why: z.string().min(1),
  }),
});

// Both Fable tasks share one structured-output format (a stable output_config
// is part of the prompt-cache key), so responses arrive in a discriminated
// envelope. The payload is validated by the task-specific schema afterwards,
// and a valid payload under the wrong task tag is rejected.
export const fableTaskSchema = z.enum(["next_question", "coach"]);

export const fableEnvelopeSchema = z.strictObject({
  task: fableTaskSchema,
  payload: z.unknown(),
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

export const artifactFilenameSchema = z.enum([
  "SPEC.md",
  "ROADMAP.md",
  "AGENTS.md",
  "DECISIONS.md",
  "ASSUMPTIONS.md",
  "OPEN_QUESTIONS.md",
]);

// One generation always snapshots the complete artifact set, so a partial or
// duplicated file list is a caller bug, not a smaller export.
export const recordArtifactSetSchema = z.object({
  sessionId: z.string().min(1),
  files: z
    .array(
      z.strictObject({
        filename: artifactFilenameSchema,
        body: z.string().min(1),
      }),
    )
    .length(artifactFilenameSchema.options.length)
    .superRefine((files, ctx) => {
      const unique = new Set(files.map((file) => file.filename));
      if (unique.size !== files.length) {
        ctx.addIssue({
          code: "custom",
          message: "Artifact filenames within a set must be unique",
        });
      }
    }),
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

export const contradictionIdSchema = z.object({
  contradictionId: z.string().min(1),
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

export const sessionInitializationStatusSchema = z.enum([
  "starting",
  "active",
  "failed",
]);

// An attempt row is created 'pending' before network I/O and settled with one
// of the other outcomes afterward; a paid call therefore always has a row.
export const modelAttemptOutcomeSchema = z.enum([
  "pending",
  "succeeded",
  "transport_failed",
  "validation_failed",
]);

export const beginModelAttemptSchema = z.object({
  sessionId: z.string().min(1),
  modelAlias: modelAliasSchema,
  executionProvenance: modelExecutionProvenanceSchema,
  estimatedCostMicrocents: z.number().int().min(0),
  confirmedOverCap: z.boolean().optional(),
  apiModelId: z.string().min(1),
  priceEffectiveDate: z.string().min(1),
});

// A transport failure never learned its real spend, so its actual cost stays
// NULL and its estimate remains reserved; the other settled outcomes report
// what the response actually cost.
export const settleModelAttemptSchema = z
  .object({
    attemptId: z.string().min(1),
    outcome: z.enum(["succeeded", "transport_failed", "validation_failed"]),
    actualCostMicrocents: z.number().int().min(0).optional(),
    latencyMs: z.number().int().min(0),
    inputTokens: z.number().int().min(0).optional(),
    outputTokens: z.number().int().min(0).optional(),
    cacheReadTokens: z.number().int().min(0).optional(),
    cacheWrite5mTokens: z.number().int().min(0).optional(),
    cacheWrite1hTokens: z.number().int().min(0).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.outcome === "transport_failed" &&
      value.actualCostMicrocents !== undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "A transport failure has unknown spend; omit actualCostMicrocents",
        path: ["actualCostMicrocents"],
      });
    }
    if (
      value.outcome !== "transport_failed" &&
      value.actualCostMicrocents === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Outcome ${value.outcome} requires actualCostMicrocents`,
        path: ["actualCostMicrocents"],
      });
    }
  });

export type ProposeStatementInput = z.infer<typeof proposeStatementSchema>;
export type ArtifactFilename = z.infer<typeof artifactFilenameSchema>;
export type RecordArtifactSetInput = z.infer<typeof recordArtifactSetSchema>;
export type CoachConfidence = z.infer<typeof coachConfidenceSchema>;
export type CoachOutput = z.infer<typeof coachOutputSchema>;
export type ProposeCoachNoteInput = z.infer<typeof proposeCoachNoteSchema>;
export type EditStatementInput = z.infer<typeof editStatementSchema>;
export type EditConcernInput = z.infer<typeof editConcernSchema>;
export type SessionInitializationStatus = z.infer<
  typeof sessionInitializationStatusSchema
>;
export type ModelAttemptOutcome = z.infer<typeof modelAttemptOutcomeSchema>;
export type BeginModelAttemptInput = z.infer<typeof beginModelAttemptSchema>;
export type SettleModelAttemptInput = z.infer<typeof settleModelAttemptSchema>;
export type ModelExecutionProvenance = z.infer<
  typeof modelExecutionProvenanceSchema
>;
export type ProposeConcernInput = z.infer<typeof proposeConcernSchema>;
export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;
export type IncrementalExtractionOutput = z.infer<
  typeof incrementalExtractionOutputSchema
>;
export type QuestionCandidateOutput = z.infer<
  typeof questionCandidateOutputSchema
>;
export type ContradictionOutput = z.infer<typeof contradictionOutputSchema>;
export type AdaptiveNextQuestionOutput = z.infer<
  typeof adaptiveNextQuestionOutputSchema
>;
export type FableTask = z.infer<typeof fableTaskSchema>;
export type ProposeQuestionInput = z.infer<typeof proposeQuestionSchema>;
export type ResolveQuestionInput = z.infer<typeof resolveQuestionSchema>;
export type QuestionDisposition = z.infer<typeof questionDispositionSchema>;
export type StatementKind = z.infer<typeof statementKindSchema>;
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;
