ALTER TABLE statements ADD COLUMN revises_statement_id TEXT REFERENCES statements (id);
ALTER TABLE concerns ADD COLUMN revises_concern_id TEXT REFERENCES concerns (id);
ALTER TABLE answers ADD COLUMN disposition TEXT CHECK (
  disposition IN ('answered', 'unknown', 'deferred')
);
