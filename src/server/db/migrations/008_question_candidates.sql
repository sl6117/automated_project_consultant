-- Phase 2 slice 3: persist every validated candidate from an adaptive Fable
-- call, asked or not. Claimed scores are the model's assertions, stored for
-- calibration comparison; effective scores are app-computed and are what
-- ranked. Additive only.
CREATE TABLE question_candidates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES discovery_sessions (id),
  model_call_id TEXT REFERENCES model_calls (id),
  body TEXT NOT NULL,
  model_why_selected TEXT NOT NULL,
  concern_codes TEXT NOT NULL,
  claimed_core_gap INTEGER NOT NULL CHECK (claimed_core_gap BETWEEN 0 AND 3),
  claimed_slice_bounding INTEGER NOT NULL CHECK (
    claimed_slice_bounding BETWEEN 0 AND 3
  ),
  claimed_contradiction INTEGER NOT NULL CHECK (
    claimed_contradiction BETWEEN 0 AND 3
  ),
  effective_core_gap INTEGER NOT NULL CHECK (effective_core_gap BETWEEN 0 AND 3),
  effective_slice_bounding INTEGER NOT NULL CHECK (
    effective_slice_bounding BETWEEN 0 AND 3
  ),
  effective_contradiction INTEGER NOT NULL CHECK (
    effective_contradiction BETWEEN 0 AND 3
  ),
  effective_total INTEGER NOT NULL CHECK (effective_total BETWEEN 0 AND 9),
  model_rank INTEGER NOT NULL CHECK (model_rank >= 1),
  rubric_rank INTEGER NOT NULL CHECK (rubric_rank >= 1),
  selected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
