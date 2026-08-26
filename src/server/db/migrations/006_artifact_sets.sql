-- The slice-1 artifact_versions table was a placeholder no code path ever
-- wrote. Recreate it with a shared artifact_set_id so the six files of one
-- generation are grouped, and enforce append-only snapshots at the database
-- level with triggers.
--
-- Guard: replacing the table is only safe while it is empty. A legacy row
-- fails the CHECK below and rolls back the migration before anything drops.
CREATE TEMP TABLE artifact_versions_must_be_empty (
  legacy_rows INTEGER NOT NULL CHECK (legacy_rows = 0)
);
INSERT INTO artifact_versions_must_be_empty SELECT COUNT(*) FROM artifact_versions;
DROP TABLE artifact_versions_must_be_empty;

DROP TABLE artifact_versions;

CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES discovery_sessions (id),
  artifact_set_id TEXT NOT NULL,
  filename TEXT NOT NULL CHECK (
    filename IN (
      'SPEC.md',
      'ROADMAP.md',
      'AGENTS.md',
      'DECISIONS.md',
      'ASSUMPTIONS.md',
      'OPEN_QUESTIONS.md'
    )
  ),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (artifact_set_id, filename)
);

-- Version rows are point-in-time evidence of what was projected. They are
-- never repaired in place: a compiler fix appends a new set instead.
CREATE TRIGGER artifact_versions_immutable_update
BEFORE UPDATE ON artifact_versions
BEGIN
  SELECT RAISE(ABORT, 'artifact_versions rows are immutable');
END;

CREATE TRIGGER artifact_versions_immutable_delete
BEFORE DELETE ON artifact_versions
BEGIN
  SELECT RAISE(ABORT, 'artifact_versions rows are immutable');
END;
