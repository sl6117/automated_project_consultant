-- The slice-1 coach_notes table was a placeholder that no code path ever
-- wrote, so it can be recreated in place with the structured coaching
-- contract: recommendation, why now, technique, tradeoffs, gotcha,
-- confidence, and the evidence that would change the advice.
--
-- Guard: replacing the table is only safe while it is empty. If any ledger
-- somehow holds legacy coach_notes rows, the CHECK below fails the INSERT and
-- the migration transaction rolls back before anything is dropped.
CREATE TEMP TABLE coach_notes_must_be_empty (
  legacy_rows INTEGER NOT NULL CHECK (legacy_rows = 0)
);
INSERT INTO coach_notes_must_be_empty SELECT COUNT(*) FROM coach_notes;
DROP TABLE coach_notes_must_be_empty;

DROP TABLE coach_notes;

CREATE TABLE coach_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES discovery_sessions (id),
  question_id TEXT REFERENCES questions (id),
  recommendation TEXT NOT NULL,
  why_now TEXT NOT NULL,
  technique TEXT NOT NULL,
  tradeoffs TEXT NOT NULL,
  gotcha TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  evidence_would_change TEXT NOT NULL,
  promoted INTEGER NOT NULL DEFAULT 0,
  provenance_source TEXT NOT NULL CHECK (
    provenance_source IN ('user', 'model-inference')
  ),
  model_call_id TEXT REFERENCES model_calls (id),
  created_at TEXT NOT NULL
);

-- Promotion copies coach wording into an approved user-provenance statement;
-- this link records which note the wording came from. Compilers read
-- statements only and never select from coach_notes.
ALTER TABLE statements ADD COLUMN promoted_from_coach_note_id TEXT
  REFERENCES coach_notes (id);
