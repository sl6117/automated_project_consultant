-- Phase 2 slice 4: contradictions are model-surfaced tensions between
-- approved statements. The model only surfaces them; the sole close paths are
-- user actions — dismiss (false positive) or retract/revise a cited statement
-- (resolved). Closed rows persist as provenance. framed_at records the user's
-- explicit "first slice is framed" confirmation and is never cleared.
-- Additive only.
CREATE TABLE contradictions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES discovery_sessions (id),
  model_call_id TEXT REFERENCES model_calls (id),
  summary TEXT NOT NULL,
  cited_statement_ids TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'dismissed', 'resolved')
  ),
  created_at TEXT NOT NULL,
  closed_at TEXT
);

ALTER TABLE discovery_sessions ADD COLUMN framed_at TEXT;
