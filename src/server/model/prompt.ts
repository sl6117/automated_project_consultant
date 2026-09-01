// Prompt construction: a byte-stable cached prefix (policy, concern
// ontology, output contracts, coaching rules) followed by the dynamic
// per-call suffix. One volatile byte in the prefix would invalidate the cache
// for everything after it, so nothing session-specific may appear before the
// breakpoint. Prompt caching also has minimum cacheable lengths (1,024 tokens
// for Sonnet-class models, 512 for larger ones), so the prefix must stay
// comfortably above them — buildSystemPrefix is tested for that.

import { modelCatalog } from "./config";
import { toWireSchema } from "./wire-schema";

export type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

const POLICY = `You are an automated project-framing consultant and decision coach. Your job is to convert a rough project idea into a traceable, minimum-sufficient project seed: typed statements, concern coverage, one next question at a time, and optional coaching about the decision at hand. You are not a complete-specification generator, and you never pretend the seed is finished.

Operating rules, in priority order:
1. Humans own decisions. You recommend, question, and challenge; only an explicit user action makes anything canonical. Every claim you produce is a proposal until the user approves, edits, or rejects it.
2. Never invent facts the user did not state. When the idea does not answer a question, mark the gap as a hypothesis, unknown, or open concern instead of guessing. A wrong confident claim is worse than an honest gap.
3. Distinguish what the user asserted from what you inferred. Content you infer carries model provenance and must survive review before it becomes ledger state; do not phrase inferences as if the user said them.
4. Be minimum-sufficient. Prefer the smallest set of statements, concerns, and questions that lets a first vertical slice proceed. Do not enumerate every conceivable requirement; surface the few that bound the work.
5. Respond with a single JSON object matching the requested contract exactly: no markdown fences, no commentary before or after, no fields beyond the contract, no null placeholders for required fields. If you cannot produce a compliant object, produce the closest compliant object with honest low-confidence content rather than breaking the format.
6. Never request, echo, or store secrets, credentials, API keys, or sensitive personal documents. If the idea contains them, ignore their values and note the handling concern instead.`;

const ONTOLOGY = `Concern ontology. These ten codes are the only valid concern codes, and each coverage claim must state concretely what the idea establishes about that concern, not restate the concern's definition:
- problem: the actual pain or need being solved, for whom it is a problem today, and what currently happens without the project. A restatement of the solution is not a problem statement.
- user: who operates and who benefits, how many of them there are, and what context they work in. A project with an unnamed operator has an unowned workflow.
- workflow: the end-to-end path work travels — where items enter, who touches them, in what order, and where they exit. Capture points and handoffs live here.
- data: what information the system holds, where it comes from, its shape and volume, and what must never be lost or leaked. Retention and export expectations belong here.
- safety: harm that misuse, failure, or bad output could cause, and the guardrails that bound it. Includes privacy exposure, irreversible actions, and abuse paths.
- quality: how good the output must be to be useful, how correctness is judged, and what level of error is tolerable at the start versus later.
- operations: who runs the system day to day, what maintenance it needs, what it costs to keep alive, and what happens when it breaks at an inconvenient time.
- constraints: hard limits the solution must respect — budget, time, stack, hosting, compliance, skills available. A constraint is a fact about the environment, not a preference.
- non-goals: what the project deliberately will not do in this phase. Explicit exclusions prevent silent scope growth and belong in the seed from the start.
- success: the observable evidence that the project worked — behavior changes, numbers moved, or work made unnecessary. If success cannot be observed, the framing is not done.

Statement kinds. These five kinds are the only valid kinds:
- fact: something the user asserted or that follows directly from their words, safe to build on without confirmation.
- decision: a choice that has been made or is being proposed for the user to ratify; decisions bound the design space.
- hypothesis: a plausible belief that should be tested before it is relied on; state it so its test is obvious.
- unknown: a question that matters but has no answer yet; naming it is progress, guessing is not.
- deferred: a question or choice deliberately postponed; record it so postponement stays a decision rather than an accident.`;

const CONTRACTS = `Output contracts. Every response is exactly one JSON object for the task requested, with these shapes:

Extraction contract (extraction task only): {"statements": [{"kind": "<fact|decision|hypothesis|unknown|deferred>", "body": "<one self-contained sentence>"}, ...], "concerns": [{"code": "<one of the ten concern codes>", "coverage": "<what the idea concretely establishes about this concern>"}, ...]}. Statements must be at least one and minimum-sufficient. Each body must stand alone without the original idea text beside it. Concerns include only codes the idea actually says something about; omit codes it is silent on rather than writing empty coverage.

Consultant envelope (next-question and coach tasks): respond with {"task": "<next_question|coach>", "payload": <the task's payload object>}. The task field must name the task you were asked to perform, and the payload must match that task's contract exactly.

Next-question payload: {"candidates": [{"body": "<exactly one question>", "whySelected": "<your reason>", "concernCodes": ["<one or more ontology codes this question addresses>"], "claimedScores": {"coreGap": 0-3, "sliceBounding": 0-3, "contradictionResolution": 0-3}, "targetsContradictionIndexes": [<indexes into your contradictions array>]}, ...], "contradictions": [{"summary": "<a real tension between approved statements>", "citedStatementIds": ["<at least two approved statement ids from the prompt>"]}, ...], "readyAdvice": {"ready": true|false, "why": "<advisory only>"}}. Offer one to five candidates, each exactly one question, never a bundle, never a question the ledger already answers. Claimed scores are your honest 0-3 assessments: coreGap for how directly the question fills uncovered core concerns, sliceBounding for how much it bounds the first vertical slice, contradictionResolution for how directly it resolves a cited tension. The application recomputes coreGap and contradictionResolution deterministically from the ledger and ranks with those; only your sliceBounding claim influences ranking, and all claims are stored and compared for calibration. Cite contradictions only between statement ids actually supplied in the prompt; an unknown id invalidates the entire response. An empty contradictions array is valid. readyAdvice is advisory and never decides stopping by itself.

Coach payload: {"recommendation": "<the single advised action>", "whyNow": "<why this advice applies to the current decision>", "technique": "<the named technique or practice to apply>", "tradeoffs": "<what the advice costs or risks>", "gotcha": "<the most likely way following this advice goes wrong>", "confidence": "<low|medium|high>", "evidenceWouldChange": "<the concrete observation that would falsify or change this advice>"}. Every field is required. Confidence states how much to trust the advice given the evidence available. evidenceWouldChange must name something observable, not a vague caveat — advice without a falsifier is unaccountable.`;

const COACHING_RULES = `Coaching rules. Coaching is advice about the decision behind the current question, not new project facts:
- Ground advice in the approved ledger context supplied with the request. Approved statements outrank the raw idea; do not advise against something the user already decided without naming that tension in tradeoffs.
- Recommend one primary action, not a menu. If two paths are genuinely equal, recommend the cheaper-to-reverse one and say why in tradeoffs.
- Confidence is low when the advice rests mainly on general practice, medium when the ledger supports it, high only when the ledger plus the user's own words leave little room for the alternative.
- Coaching is excluded from exported specifications unless the user explicitly promotes it, so write advice as advice — never phrase it as if it were already the project's decision.`;

export function buildSystemPrefix(): SystemBlock[] {
  return [
    { type: "text", text: POLICY },
    {
      type: "text",
      text: `${ONTOLOGY}\n\n${CONTRACTS}\n\n${COACHING_RULES}`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

// JSON Schemas for the API's structured-output format, mirroring the Zod
// contracts that gate persistence. The runtime Zod check stays authoritative.
// The literals below state the FULL contract; toWireSchema strips the
// keywords the provider's validator rejects before anything reaches the
// wire, so authors write intent here and the supported subset is enforced
// in one place (see wire-schema.ts).
const statementKindEnum = [
  "fact",
  "decision",
  "hypothesis",
  "unknown",
  "deferred",
];
const concernCodeEnum = [
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
];

export const extractionOutputFormat = {
  type: "json_schema" as const,
  schema: toWireSchema({
    type: "object",
    additionalProperties: false,
    required: ["statements", "concerns"],
    properties: {
      statements: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "body"],
          properties: {
            kind: { type: "string", enum: statementKindEnum },
            body: { type: "string", minLength: 1 },
          },
        },
      },
      concerns: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["code", "coverage"],
          properties: {
            code: { type: "string", enum: concernCodeEnum },
            coverage: { type: "string", minLength: 1 },
          },
        },
      },
    },
  }),
};

const nextQuestionPayloadJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["candidates", "contradictions", "readyAdvice"],
  properties: {
    candidates: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "body",
          "whySelected",
          "concernCodes",
          "claimedScores",
          "targetsContradictionIndexes",
        ],
        properties: {
          body: { type: "string", minLength: 1 },
          whySelected: { type: "string", minLength: 1 },
          concernCodes: {
            type: "array",
            minItems: 1,
            items: { type: "string", enum: concernCodeEnum },
          },
          claimedScores: {
            type: "object",
            additionalProperties: false,
            required: ["coreGap", "sliceBounding", "contradictionResolution"],
            properties: {
              coreGap: { type: "integer", minimum: 0, maximum: 3 },
              sliceBounding: { type: "integer", minimum: 0, maximum: 3 },
              contradictionResolution: {
                type: "integer",
                minimum: 0,
                maximum: 3,
              },
            },
          },
          targetsContradictionIndexes: {
            type: "array",
            items: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    contradictions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "citedStatementIds"],
        properties: {
          summary: { type: "string", minLength: 1 },
          citedStatementIds: {
            type: "array",
            minItems: 2,
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
    readyAdvice: {
      type: "object",
      additionalProperties: false,
      required: ["ready", "why"],
      properties: {
        ready: { type: "boolean" },
        why: { type: "string", minLength: 1 },
      },
    },
  },
};

const coachPayloadJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "recommendation",
    "whyNow",
    "technique",
    "tradeoffs",
    "gotcha",
    "confidence",
    "evidenceWouldChange",
  ],
  properties: {
    recommendation: { type: "string", minLength: 1 },
    whyNow: { type: "string", minLength: 1 },
    technique: { type: "string", minLength: 1 },
    tradeoffs: { type: "string", minLength: 1 },
    gotcha: { type: "string", minLength: 1 },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    evidenceWouldChange: { type: "string", minLength: 1 },
  },
};

// Incremental extraction reuses the extraction item shapes but allows both
// arrays to be empty: an answer that adds nothing new is a valid outcome.
// This is a distinct Sonnet task with its own output_config; the extraction
// format is used exactly once per session (at start), so the single
// cache-write on the transition to incremental costs one write, not the
// per-switch thrashing a shared-format envelope prevents on the Fable side.
export const incrementalExtractionOutputFormat = {
  type: "json_schema" as const,
  schema: toWireSchema({
    type: "object",
    additionalProperties: false,
    required: ["statements", "concerns"],
    properties: {
      statements: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "body"],
          properties: {
            kind: { type: "string", enum: statementKindEnum },
            body: { type: "string", minLength: 1 },
          },
        },
      },
      concerns: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["code", "coverage"],
          properties: {
            code: { type: "string", enum: concernCodeEnum },
            coverage: { type: "string", minLength: 1 },
          },
        },
      },
    },
  }),
};

// One tagged output format shared byte-identically by BOTH Fable tasks:
// output_config is part of the prompt-cache key, so a per-task schema would
// force a fresh cache write on every task switch. The discriminated envelope
// keeps structured output strict (anyOf of the two strict payload schemas)
// while the task/payload pairing is enforced by Zod after the envelope.
export const fableOutputFormat = {
  type: "json_schema" as const,
  schema: toWireSchema({
    type: "object",
    additionalProperties: false,
    required: ["task", "payload"],
    properties: {
      task: { type: "string", enum: ["next_question", "coach"] },
      payload: {
        anyOf: [nextQuestionPayloadJsonSchema, coachPayloadJsonSchema],
      },
    },
  }),
};

// One exact request description per task. The cost estimator and the live
// SDK call both consume the same description object, so the estimate's byte
// bound covers everything actually sent — system blocks, rendered user
// message, task-specific output schema, and max tokens — with no duplicated
// prompt construction.
export type ModelRequestDescription = {
  model: string;
  max_tokens: number;
  system: SystemBlock[];
  messages: { role: "user"; content: string }[];
  output_config: {
    format:
      | typeof extractionOutputFormat
      | typeof incrementalExtractionOutputFormat
      | typeof fableOutputFormat;
  };
};

export type ResolvedAnswerContext = {
  questionBody: string;
  answerBody: string;
  disposition: string;
};

export function describeIncrementalExtractionRequest(input: {
  projectName: string;
  idea: string;
  approved: ApprovedLedgerSlice;
  resolved: ResolvedAnswerContext;
}): ModelRequestDescription {
  return {
    model: modelCatalog.sonnet.apiId,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: buildSystemPrefix(),
    messages: [
      { role: "user", content: buildIncrementalExtractionUserMessage(input) },
    ],
    output_config: { format: incrementalExtractionOutputFormat },
  };
}

export function buildIncrementalExtractionUserMessage(input: {
  projectName: string;
  idea: string;
  approved: ApprovedLedgerSlice;
  resolved: ResolvedAnswerContext;
}): string {
  return [
    "Incremental extraction: propose only the NEW statements and concern",
    "coverage that the answer below adds beyond the approved ledger. Do not",
    "restate rows that are already approved. If the answer adds nothing new,",
    "return empty statements and concerns arrays — that is a valid, honest",
    "response; never invent content to fill them.",
    `Project name: ${input.projectName}`,
    `Rough idea: ${input.idea}`,
    APPROVED_STATEMENTS_HEADING,
    input.approved.statements.length > 0
      ? input.approved.statements
          .map((row) => `- [${row.id}] ${row.body}`)
          .join("\n")
      : "- (none approved yet)",
    APPROVED_CONCERNS_HEADING,
    input.approved.concerns.length > 0
      ? input.approved.concerns
          .map((row) => `- [${row.id}] ${row.code}: ${row.coverage}`)
          .join("\n")
      : "- (none approved yet)",
    `Resolved question: ${input.resolved.questionBody}`,
    `Disposition: ${input.resolved.disposition}`,
    `Answer: ${input.resolved.answerBody}`,
  ].join("\n");
}

export const MAX_OUTPUT_TOKENS = 1_500;

// Next-question is the most output-hungry contract — up to five candidates
// with reasons, contradictions, and readiness advice — and 1,500 tokens
// truncated real responses (stop_reason=max_tokens, evidenced live
// 2026-09-01 across two windows). Only this task gets the higher ceiling;
// extraction, incremental, and coaching keep MAX_OUTPUT_TOKENS. Cost
// estimates derive from the request's own max_tokens, so the reservation
// bound grows with it automatically.
export const NEXT_QUESTION_MAX_OUTPUT_TOKENS = 3_000;

export function describeExtractionRequest(input: {
  projectName: string;
  idea: string;
}): ModelRequestDescription {
  return {
    model: modelCatalog.sonnet.apiId,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: buildSystemPrefix(),
    messages: [{ role: "user", content: buildExtractionUserMessage(input) }],
    output_config: { format: extractionOutputFormat },
  };
}

// The approved ledger slice for the adaptive path: rows carry their ids
// because downstream ranking and contradiction citations reference them.
// This is dynamic suffix material only — never prefix.
export type ApprovedLedgerSlice = {
  statements: { id: string; body: string }[];
  concerns: { id: string; code: string; coverage: string }[];
};

// The rest of the spec-required adaptive context: missing core codes, open
// tensions, and resolved questions. Also dynamic suffix material only, and
// required: every adaptive request states this context explicitly, even when
// it is empty.
export type AdaptiveLedgerContext = {
  missingCoreCodes: string[];
  openContradictions: { id: string; summary: string }[];
  resolvedQuestions: { body: string; disposition: string }[];
};

// Section headings shared with the recorded client's placeholder
// substitution: parsing the statement-id section by these exact strings keeps
// the fixture plumbing from silently drifting when a heading is reworded.
export const APPROVED_STATEMENTS_HEADING = "Approved statements (id: body):";
export const APPROVED_CONCERNS_HEADING =
  "Approved concern coverage (id: code: coverage):";

export function describeNextQuestionRequest(input: {
  projectName: string;
  idea: string;
  approved: ApprovedLedgerSlice;
  context: AdaptiveLedgerContext;
}): ModelRequestDescription {
  return {
    model: modelCatalog.fable.apiId,
    max_tokens: NEXT_QUESTION_MAX_OUTPUT_TOKENS,
    system: buildSystemPrefix(),
    messages: [{ role: "user", content: buildNextQuestionUserMessage(input) }],
    output_config: { format: fableOutputFormat },
  };
}

export function describeCoachRequest(input: {
  projectName: string;
  idea: string;
  questionBody: string;
  approvedStatements: string[];
  approvedConcerns: string[];
}): ModelRequestDescription {
  return {
    model: modelCatalog.fable.apiId,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: buildSystemPrefix(),
    messages: [{ role: "user", content: buildCoachUserMessage(input) }],
    output_config: { format: fableOutputFormat },
  };
}

export function buildExtractionUserMessage(input: {
  projectName: string;
  idea: string;
}): string {
  return [
    "Extract typed statements and concern coverage from this rough idea.",
    `Project name: ${input.projectName}`,
    `Rough idea: ${input.idea}`,
  ].join("\n");
}

export function buildNextQuestionUserMessage(input: {
  projectName: string;
  idea: string;
  approved: ApprovedLedgerSlice;
  context: AdaptiveLedgerContext;
}): string {
  const context = input.context;
  return [
    "Choose the single next question that most reduces uncertainty, and say",
    "why it was selected. The approved ledger rows below are canonical,",
    "human-ratified state and outrank the raw idea; their ids identify them.",
    `Project name: ${input.projectName}`,
    `Rough idea: ${input.idea}`,
    APPROVED_STATEMENTS_HEADING,
    input.approved.statements.length > 0
      ? input.approved.statements
          .map((row) => `- [${row.id}] ${row.body}`)
          .join("\n")
      : "- (none approved yet)",
    APPROVED_CONCERNS_HEADING,
    input.approved.concerns.length > 0
      ? input.approved.concerns
          .map((row) => `- [${row.id}] ${row.code}: ${row.coverage}`)
          .join("\n")
      : "- (none approved yet)",
    "Missing core concern codes (uncovered gaps, in ontology order):",
    context.missingCoreCodes.length > 0
      ? context.missingCoreCodes.map((code) => `- ${code}`).join("\n")
      : "- (none)",
    "Open tensions already raised (id: summary); do not re-raise these:",
    context.openContradictions.length > 0
      ? context.openContradictions
          .map((row) => `- [${row.id}] ${row.summary}`)
          .join("\n")
      : "- (none)",
    "Resolved questions (disposition: body); do not ask these again:",
    context.resolvedQuestions.length > 0
      ? context.resolvedQuestions
          .map((row) => `- ${row.disposition}: ${row.body}`)
          .join("\n")
      : "- (none)",
  ].join("\n");
}

export function buildCoachUserMessage(input: {
  projectName: string;
  idea: string;
  questionBody: string;
  approvedStatements: string[];
  approvedConcerns: string[];
}): string {
  return [
    "Coach the user on the decision behind the current question.",
    `Project name: ${input.projectName}`,
    `Rough idea: ${input.idea}`,
    "Approved ledger statements (canonical, outrank the raw idea):",
    input.approvedStatements.length > 0
      ? input.approvedStatements.map((body) => `- ${body}`).join("\n")
      : "- (none approved yet)",
    "Approved concern coverage:",
    input.approvedConcerns.length > 0
      ? input.approvedConcerns.map((coverage) => `- ${coverage}`).join("\n")
      : "- (none approved yet)",
    `Current question: ${input.questionBody}`,
  ].join("\n");
}
