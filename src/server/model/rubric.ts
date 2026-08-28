import {
  concernCodeSchema,
  type AdaptiveNextQuestionOutput,
  type QuestionCandidateOutput,
} from "../ledger/schemas";

// Ontology order is the schema enum order; the first four are the core codes
// that block stopping when uncovered.
export const ONTOLOGY_ORDER = concernCodeSchema.options;
export const CORE_CODES: readonly string[] = [
  "problem",
  "user",
  "workflow",
  "success",
];

export type EffectiveScores = {
  effectiveCoreGap: number;
  effectiveSliceBounding: number;
  effectiveContradiction: number;
  effectiveTotal: number;
};

export type RankedCandidate = {
  candidate: QuestionCandidateOutput;
  payloadIndex: number;
  modelRank: number;
  rubricRank: number;
  scores: EffectiveScores;
};

// Deterministic scoring. coreGap and contradictionResolution come from the
// ledger and the payload's own contradictions — the claimed values are stored
// for calibration comparison and never used here. sliceBounding is the one
// model-movable dimension, clamped to 0-3.
export function scoreCandidate(
  candidate: QuestionCandidateOutput,
  context: { approvedConcernCodes: ReadonlySet<string> },
): EffectiveScores {
  const missingCore = candidate.concernCodes.some(
    (code) =>
      CORE_CODES.includes(code) && !context.approvedConcernCodes.has(code),
  );
  const missingOptional = candidate.concernCodes.some(
    (code) => !context.approvedConcernCodes.has(code),
  );
  const effectiveCoreGap = missingCore ? 3 : missingOptional ? 1 : 0;

  const effectiveContradiction =
    candidate.targetsContradictionIndexes.length > 0 ? 3 : 0;

  const effectiveSliceBounding = Math.max(
    0,
    Math.min(3, candidate.claimedScores.sliceBounding),
  );

  return {
    effectiveCoreGap,
    effectiveSliceBounding,
    effectiveContradiction,
    effectiveTotal:
      effectiveCoreGap + effectiveSliceBounding + effectiveContradiction,
  };
}

// Sort by effective total descending, then ontology order of the candidate's
// first concern code, then payload index. Never random.
export function rankCandidates(
  payload: AdaptiveNextQuestionOutput,
  context: { approvedConcernCodes: ReadonlySet<string> },
): RankedCandidate[] {
  const scored = payload.candidates.map((candidate, payloadIndex) => ({
    candidate,
    payloadIndex,
    modelRank: payloadIndex + 1,
    scores: scoreCandidate(candidate, context),
  }));

  const sorted = [...scored].sort((a, b) => {
    if (a.scores.effectiveTotal !== b.scores.effectiveTotal) {
      return b.scores.effectiveTotal - a.scores.effectiveTotal;
    }
    const aOrder = ONTOLOGY_ORDER.indexOf(a.candidate.concernCodes[0]!);
    const bOrder = ONTOLOGY_ORDER.indexOf(b.candidate.concernCodes[0]!);
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return a.payloadIndex - b.payloadIndex;
  });

  return sorted.map((entry, index) => ({ ...entry, rubricRank: index + 1 }));
}

// The pending question's why_selected is the rubric's explanation, not the
// model's prose (which stays on the candidate row).
export function rubricExplanation(winner: RankedCandidate): string {
  const { scores } = winner;
  return [
    `Rubric winner with effective total ${scores.effectiveTotal}/9`,
    `(core gap ${scores.effectiveCoreGap},`,
    `slice bounding ${scores.effectiveSliceBounding},`,
    `contradiction resolution ${scores.effectiveContradiction}).`,
    `Model ranked it #${winner.modelRank}; the rubric ranked it #1.`,
    "Effective core-gap and contradiction scores are computed from the ledger;",
    "claimed scores are stored for comparison only.",
  ].join(" ");
}
