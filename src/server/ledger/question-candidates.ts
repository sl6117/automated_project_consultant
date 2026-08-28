import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { nowIso } from "./projects";
import { LedgerValidationError } from "./statements";

export type QuestionCandidateRow = {
  id: string;
  session_id: string;
  model_call_id: string | null;
  body: string;
  model_why_selected: string;
  concern_codes: string;
  claimed_core_gap: number;
  claimed_slice_bounding: number;
  claimed_contradiction: number;
  effective_core_gap: number;
  effective_slice_bounding: number;
  effective_contradiction: number;
  effective_total: number;
  model_rank: number;
  rubric_rank: number;
  selected: number;
  created_at: string;
};

export type CandidateInsert = {
  body: string;
  modelWhySelected: string;
  concernCodes: string[];
  claimedCoreGap: number;
  claimedSliceBounding: number;
  claimedContradiction: number;
  effectiveCoreGap: number;
  effectiveSliceBounding: number;
  effectiveContradiction: number;
  effectiveTotal: number;
  modelRank: number;
  rubricRank: number;
  selected: boolean;
};

// Plain inserts with no transaction of their own: the caller composes them
// with the winning question insert into one atomic content commit.
export function insertQuestionCandidates(
  db: Database.Database,
  input: {
    sessionId: string;
    modelCallId: string;
    candidates: CandidateInsert[];
  },
): void {
  const createdAt = nowIso();
  const insert = db.prepare(
    `INSERT INTO question_candidates (
      id, session_id, model_call_id, body, model_why_selected, concern_codes,
      claimed_core_gap, claimed_slice_bounding, claimed_contradiction,
      effective_core_gap, effective_slice_bounding, effective_contradiction,
      effective_total, model_rank, rubric_rank, selected, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  try {
    for (const candidate of input.candidates) {
      insert.run(
        randomUUID(),
        input.sessionId,
        input.modelCallId,
        candidate.body,
        candidate.modelWhySelected,
        JSON.stringify(candidate.concernCodes),
        candidate.claimedCoreGap,
        candidate.claimedSliceBounding,
        candidate.claimedContradiction,
        candidate.effectiveCoreGap,
        candidate.effectiveSliceBounding,
        candidate.effectiveContradiction,
        candidate.effectiveTotal,
        candidate.modelRank,
        candidate.rubricRank,
        candidate.selected ? 1 : 0,
        createdAt,
      );
    }
  } catch (error) {
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Candidate insert failed",
    );
  }
}

export function listCandidatesForModelCall(
  db: Database.Database,
  modelCallId: string,
): QuestionCandidateRow[] {
  return db
    .prepare(
      "SELECT * FROM question_candidates WHERE model_call_id = ? ORDER BY rubric_rank",
    )
    .all(modelCallId) as QuestionCandidateRow[];
}
