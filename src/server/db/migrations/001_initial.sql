PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE discovery_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  cap_cents INTEGER NOT NULL DEFAULT 500,
  created_at TEXT NOT NULL
);

CREATE TABLE model_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES discovery_sessions (id),
  model_alias TEXT NOT NULL,
  recorded INTEGER NOT NULL DEFAULT 1,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE statements (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES discovery_sessions (id),
  kind TEXT NOT NULL CHECK (
    kind IN ('fact', 'decision', 'hypothesis', 'unknown', 'deferred')
  ),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected')),
  body TEXT NOT NULL,
  provenance_source TEXT NOT NULL CHECK (
    provenance_source IN ('user', 'model-inference')
  ),
  model_call_id TEXT REFERENCES model_calls (id),
  created_at TEXT NOT NULL
);

CREATE TABLE concerns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES discovery_sessions (id),
  code TEXT NOT NULL CHECK (
    code IN (
      'problem',
      'user',
      'workflow',
      'data',
      'safety',
      'quality',
      'operations',
      'constraints',
      'non-goals',
      'success'
    )
  ),
  coverage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected')),
  provenance_source TEXT NOT NULL CHECK (
    provenance_source IN ('user', 'model-inference')
  ),
  model_call_id TEXT REFERENCES model_calls (id),
  created_at TEXT NOT NULL
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES discovery_sessions (id),
  body TEXT NOT NULL,
  why_selected TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'superseded')),
  provenance_source TEXT NOT NULL CHECK (
    provenance_source IN ('user', 'model-inference')
  ),
  model_call_id TEXT REFERENCES model_calls (id),
  created_at TEXT NOT NULL
);

CREATE TABLE answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions (id),
  body TEXT NOT NULL,
  provenance_source TEXT NOT NULL CHECK (
    provenance_source IN ('user', 'model-inference')
  ),
  created_at TEXT NOT NULL
);

CREATE TABLE coach_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES discovery_sessions (id),
  body TEXT NOT NULL,
  promoted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES discovery_sessions (id),
  filename TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
