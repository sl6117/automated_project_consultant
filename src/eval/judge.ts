import { z } from "zod";
import { modelCatalog } from "../server/model/config";
import { toWireSchema } from "../server/model/wire-schema";
import type { Brief } from "./corpus-schemas";
import type { ReplayTranscript } from "./replay";

// The Sonnet judge for the subjective rubric dimensions: statement
// faithfulness, question usefulness at labeled turns, and minimum-sufficiency
// of the final artifact set. No Fable judge and no third Fable task — the
// Phase 2 consultant envelope and its prompt cache stay untouched; this is a
// separate Sonnet prompt that never flows through the consultant builders.
//
// Judge prompts are ID-FREE BY CONSTRUCTION: they carry brief text,
// transcript text, and numbered indexes only, never ledger UUIDs. That makes
// the slice 2 hash contract trivial here — the rendered request hashes as-is,
// and a fresh replay renders byte-identical requests.

const JUDGE_MAX_OUTPUT_TOKENS = 1_000;

// Structurally parallel to the consultant's ModelRequestDescription but with
// the judge's own output formats: the consultant type closes its format
// union, and the judge deliberately does not share the consultant envelope.
export type JudgeRequestDescription = {
  model: string;
  max_tokens: number;
  system: { type: "text"; text: string }[];
  messages: { role: "user"; content: string }[];
  output_config: { format: { type: "json_schema"; schema: unknown } };
};

const JUDGE_POLICY = `You are a strict evaluation judge for project-framing consultations. You grade transcripts produced by a consultant model against the synthetic brief that drove them. You are not the consultant: never rewrite, improve, or continue the consultation — only grade what happened.

Rules, in priority order:
1. Ground every judgement in the supplied brief and transcript text. The persona's scripted answers are the complete universe of user-asserted facts; anything a statement asserts beyond them is invented.
2. Scores are integers on the stated scale. Use the whole scale: reserve the extremes for clear cases and justify every score in one or two sentences.
3. Respond with a single JSON object matching the requested contract exactly: no markdown fences, no commentary, no extra fields.
4. When the evidence is genuinely ambiguous, choose the middle of the scale and say why, rather than guessing an extreme.`;

// --- Output contracts (Zod is the persistence gate, mirrored JSON schema
// --- steers the structured-output API).

export const faithfulnessOutputSchema = z.strictObject({
  verdicts: z
    .array(
      z.strictObject({
        index: z.number().int().min(0),
        verdict: z.enum(["grounded", "invented"]),
        why: z.string().min(1),
      }),
    )
    .min(1),
});

export const usefulnessOutputSchema = z.strictObject({
  score: z.number().int().min(1).max(5),
  why: z.string().min(1),
});

export const sufficiencyOutputSchema = z.strictObject({
  score: z.number().int().min(1).max(5),
  why: z.string().min(1),
});

export const pairwiseOutputSchema = z.strictObject({
  picks: z
    .array(
      z.strictObject({
        dimension: z.enum(["faithfulness", "usefulness", "sufficiency"]),
        winner: z.enum(["1", "2"]),
        why: z.string().min(1),
      }),
    )
    .length(3),
});

export type FaithfulnessOutput = z.infer<typeof faithfulnessOutputSchema>;
export type UsefulnessOutput = z.infer<typeof usefulnessOutputSchema>;
export type SufficiencyOutput = z.infer<typeof sufficiencyOutputSchema>;
export type PairwiseOutput = z.infer<typeof pairwiseOutputSchema>;

// Literals state the full contract; toWireSchema strips the keywords the
// provider's validator rejects before anything reaches the wire. The Zod
// gates above stay authoritative.
const faithfulnessJsonSchema = {
  type: "json_schema" as const,
  schema: toWireSchema({
    type: "object",
    additionalProperties: false,
    required: ["verdicts"],
    properties: {
      verdicts: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "verdict", "why"],
          properties: {
            index: { type: "integer", minimum: 0 },
            verdict: { type: "string", enum: ["grounded", "invented"] },
            why: { type: "string", minLength: 1 },
          },
        },
      },
    },
  }),
};

const scoreJsonSchema = {
  type: "json_schema" as const,
  schema: toWireSchema({
    type: "object",
    additionalProperties: false,
    required: ["score", "why"],
    properties: {
      score: { type: "integer", minimum: 1, maximum: 5 },
      why: { type: "string", minLength: 1 },
    },
  }),
};

const pairwiseJsonSchema = {
  type: "json_schema" as const,
  schema: toWireSchema({
    type: "object",
    additionalProperties: false,
    required: ["picks"],
    properties: {
      picks: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["dimension", "winner", "why"],
          properties: {
            dimension: {
              type: "string",
              enum: ["faithfulness", "usefulness", "sufficiency"],
            },
            winner: { type: "string", enum: ["1", "2"] },
            why: { type: "string", minLength: 1 },
          },
        },
      },
    },
  }),
};

// --- Prompt rendering. Everything is plain text; indexes replace ids.

function renderBriefSource(brief: Brief): string {
  const scripted = Object.entries(brief.answers)
    .flatMap(([code, entries]) =>
      (entries ?? []).map((entry) => `- (${code}) ${entry}`),
    )
    .join("\n");
  return [
    `Project name: ${brief.projectName}`,
    `Rough idea: ${brief.idea}`,
    "Scripted persona answers (the complete universe of user-asserted facts):",
    scripted.length > 0 ? scripted : "- (none)",
  ].join("\n");
}

function renderTurns(transcript: ReplayTranscript, upTo?: number): string {
  const turns = transcript.turns.filter(
    (turn) => upTo === undefined || turn.turn <= upTo,
  );
  if (turns.length === 0) {
    return "- (no questions were asked)";
  }
  return turns
    .map(
      (turn) =>
        `- Turn ${turn.turn}: Q: ${turn.questionBody} | A (${turn.answerDisposition}): ${turn.answerBody || "(none)"}`,
    )
    .join("\n");
}

function judgeSystem(): { type: "text"; text: string }[] {
  return [{ type: "text", text: JUDGE_POLICY }];
}

export function describeFaithfulnessRequest(input: {
  brief: Brief;
  transcript: ReplayTranscript;
}): JudgeRequestDescription {
  const statements = input.transcript.approvedStatements
    .map((statement, index) => `- [${index}] (${statement.kind}) ${statement.body}`)
    .join("\n");
  return {
    model: modelCatalog.sonnet.apiId,
    max_tokens: JUDGE_MAX_OUTPUT_TOKENS,
    system: judgeSystem(),
    messages: [
      {
        role: "user",
        content: [
          "Task: statement faithfulness. For EVERY numbered statement below,",
          "judge whether it is grounded in the brief and persona answers or",
          "invented. Paraphrase is grounded; new facts are invented. Return a",
          'verdict for every index. Contract: {"verdicts": [{"index": <n>,',
          '"verdict": "<grounded|invented>", "why": "<one sentence>"}, ...]}',
          renderBriefSource(input.brief),
          "Approved statements to judge:",
          statements.length > 0 ? statements : "- (none)",
        ].join("\n"),
      },
    ],
    output_config: { format: faithfulnessJsonSchema },
  };
}

export function describeUsefulnessRequest(input: {
  brief: Brief;
  transcript: ReplayTranscript;
  turn: number;
}): JudgeRequestDescription {
  const turn = input.transcript.turns.find(
    (entry) => entry.turn === input.turn,
  );
  if (!turn) {
    throw new Error(
      `Transcript for ${input.transcript.briefId} has no turn ${input.turn}`,
    );
  }
  return {
    model: modelCatalog.sonnet.apiId,
    max_tokens: JUDGE_MAX_OUTPUT_TOKENS,
    system: judgeSystem(),
    messages: [
      {
        role: "user",
        content: [
          "Task: question usefulness. Given the brief and the consultation so",
          `far, score how useful the consultant's turn-${input.turn} question was`,
          "for reaching a minimum-sufficient project seed. 5 = the single most",
          "valuable thing to ask; 3 = reasonable but not the best use of the",
          "turn; 1 = redundant, already answered, or off-target. Contract:",
          '{"score": <1-5>, "why": "<one or two sentences>"}',
          renderBriefSource(input.brief),
          "Consultation before this question:",
          renderTurns(input.transcript, input.turn - 1),
          `Question to score (turn ${input.turn}): ${turn.questionBody}`,
        ].join("\n"),
      },
    ],
    output_config: { format: scoreJsonSchema },
  };
}

export function describeSufficiencyRequest(input: {
  brief: Brief;
  transcript: ReplayTranscript;
}): JudgeRequestDescription {
  const spec = input.transcript.artifacts.find(
    (artifact) => artifact.filename === "SPEC.md",
  );
  return {
    model: modelCatalog.sonnet.apiId,
    max_tokens: JUDGE_MAX_OUTPUT_TOKENS,
    system: judgeSystem(),
    messages: [
      {
        role: "user",
        content: [
          "Task: minimum-sufficiency of the final artifact set. Score whether",
          "the exported seed is the SMALLEST set that lets a first vertical",
          "slice proceed: 5 = minimum and sufficient; 3 = sufficient but",
          "padded, or minimal but with one real gap; 1 = insufficient or",
          "bloated with invented scope. Contract:",
          '{"score": <1-5>, "why": "<one or two sentences>"}',
          renderBriefSource(input.brief),
          "Full consultation:",
          renderTurns(input.transcript),
          "Exported SPEC.md:",
          spec?.body ?? "(no artifact set was exported)",
        ].join("\n"),
      },
    ],
    output_config: { format: scoreJsonSchema },
  };
}

// Pairwise is for changes, not absolutes: two transcripts of the SAME brief
// from two runs. Position bias is detected by the caller evaluating both
// presentation orders (see pairwise.ts).
export function describePairwiseRequest(input: {
  brief: Brief;
  first: ReplayTranscript;
  second: ReplayTranscript;
}): JudgeRequestDescription {
  const render = (label: string, transcript: ReplayTranscript): string =>
    [
      `--- Transcript ${label} ---`,
      "Approved statements:",
      transcript.approvedStatements
        .map((statement) => `- (${statement.kind}) ${statement.body}`)
        .join("\n") || "- (none)",
      "Consultation:",
      renderTurns(transcript),
      `Outcome: ${transcript.outcome}`,
    ].join("\n");
  return {
    model: modelCatalog.sonnet.apiId,
    max_tokens: JUDGE_MAX_OUTPUT_TOKENS,
    system: judgeSystem(),
    messages: [
      {
        role: "user",
        content: [
          "Task: pairwise comparison. Two consultations of the same brief.",
          "For each dimension — faithfulness, usefulness, sufficiency — pick",
          "the better transcript and say why. Contract:",
          '{"picks": [{"dimension": "<name>", "winner": "<1|2>", "why":',
          '"<one sentence>"}, ...]} with exactly one pick per dimension.',
          renderBriefSource(input.brief),
          render("1", input.first),
          render("2", input.second),
        ].join("\n"),
      },
    ],
    output_config: { format: pairwiseJsonSchema },
  };
}

// --- Validation gates: invalid judge output is rejected before persistence
// --- and never partially applied, like every other model boundary.

export class JudgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JudgeValidationError";
  }
}

export function parseFaithfulness(
  payload: unknown,
  context: { statementCount: number },
): FaithfulnessOutput {
  const parsed = faithfulnessOutputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new JudgeValidationError(parsed.error.message);
  }
  const seen = new Set<number>();
  for (const verdict of parsed.data.verdicts) {
    if (verdict.index >= context.statementCount) {
      throw new JudgeValidationError(
        `Verdict index ${verdict.index} is out of range`,
      );
    }
    if (seen.has(verdict.index)) {
      throw new JudgeValidationError(
        `Duplicate verdict for statement ${verdict.index}`,
      );
    }
    seen.add(verdict.index);
  }
  if (seen.size !== context.statementCount) {
    throw new JudgeValidationError(
      `Expected a verdict for every one of ${context.statementCount} statements, got ${seen.size}`,
    );
  }
  return parsed.data;
}

export function parseUsefulness(payload: unknown): UsefulnessOutput {
  const parsed = usefulnessOutputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new JudgeValidationError(parsed.error.message);
  }
  return parsed.data;
}

export function parseSufficiency(payload: unknown): SufficiencyOutput {
  const parsed = sufficiencyOutputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new JudgeValidationError(parsed.error.message);
  }
  return parsed.data;
}

export function parsePairwise(payload: unknown): PairwiseOutput {
  const parsed = pairwiseOutputSchema.safeParse(payload);
  if (!parsed.success) {
    throw new JudgeValidationError(parsed.error.message);
  }
  const dimensions = new Set(parsed.data.picks.map((pick) => pick.dimension));
  if (dimensions.size !== 3) {
    throw new JudgeValidationError(
      "Pairwise picks must cover each dimension exactly once",
    );
  }
  return parsed.data;
}
