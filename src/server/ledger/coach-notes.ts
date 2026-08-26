import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { nowIso } from "./projects";
import {
  coachNoteIdSchema,
  proposeCoachNoteSchema,
  type CoachConfidence,
  type ProposeCoachNoteInput,
} from "./schemas";
import { LedgerValidationError, type StatementRow } from "./statements";

export type CoachNoteRow = {
  id: string;
  session_id: string;
  question_id: string | null;
  recommendation: string;
  why_now: string;
  technique: string;
  tradeoffs: string;
  gotcha: string;
  confidence: CoachConfidence;
  evidence_would_change: string;
  promoted: number;
  provenance_source: "user" | "model-inference";
  model_call_id: string | null;
  created_at: string;
};

export function proposeCoachNote(
  db: Database.Database,
  input: ProposeCoachNoteInput,
): CoachNoteRow {
  const parsed = proposeCoachNoteSchema.safeParse(input);
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const id = randomUUID();

  try {
    db.prepare(
      `INSERT INTO coach_notes (
        id, session_id, question_id, recommendation, why_now, technique,
        tradeoffs, gotcha, confidence, evidence_would_change,
        provenance_source, model_call_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      parsed.data.sessionId,
      parsed.data.questionId ?? null,
      parsed.data.recommendation,
      parsed.data.whyNow,
      parsed.data.technique,
      parsed.data.tradeoffs,
      parsed.data.gotcha,
      parsed.data.confidence,
      parsed.data.evidenceWouldChange,
      parsed.data.provenanceSource,
      parsed.data.modelCallId ?? null,
      nowIso(),
    );
  } catch (error) {
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Coach note write failed",
    );
  }

  return getCoachNote(db, id);
}

export function getCoachNote(db: Database.Database, id: string): CoachNoteRow {
  const row = db
    .prepare("SELECT * FROM coach_notes WHERE id = ?")
    .get(id) as CoachNoteRow | undefined;
  if (!row) {
    throw new LedgerValidationError(`Coach note ${id} not found`);
  }
  return row;
}

export function listCoachNotes(
  db: Database.Database,
  sessionId: string,
): CoachNoteRow[] {
  return db
    .prepare(
      "SELECT * FROM coach_notes WHERE session_id = ? ORDER BY created_at",
    )
    .all(sessionId) as CoachNoteRow[];
}

// Promotion never changes what the compiler reads from coach_notes (it reads
// nothing there): it inserts a new approved statement asserted by the user,
// with a link back to the note that supplied the wording. The note itself is
// only flagged for history.
export function promoteCoachNote(
  db: Database.Database,
  coachNoteId: string,
): { note: CoachNoteRow; statement: StatementRow } {
  const parsed = coachNoteIdSchema.safeParse({ coachNoteId });
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const run = db.transaction(() => {
    const note = getCoachNote(db, parsed.data.coachNoteId);
    if (note.promoted !== 0) {
      throw new LedgerValidationError(
        `Coach note ${note.id} is already promoted`,
      );
    }

    db.prepare("UPDATE coach_notes SET promoted = 1 WHERE id = ?").run(note.id);

    const statementId = randomUUID();
    db.prepare(
      `INSERT INTO statements (
        id, session_id, kind, status, body, provenance_source, model_call_id,
        promoted_from_coach_note_id, created_at
      ) VALUES (?, ?, 'decision', 'approved', ?, 'user', NULL, ?, ?)`,
    ).run(statementId, note.session_id, note.recommendation, note.id, nowIso());

    const statement = db
      .prepare("SELECT * FROM statements WHERE id = ?")
      .get(statementId) as StatementRow;

    return { note: getCoachNote(db, note.id), statement };
  });

  try {
    return run();
  } catch (error) {
    if (error instanceof LedgerValidationError) {
      throw error;
    }
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Coach note promotion failed",
    );
  }
}
