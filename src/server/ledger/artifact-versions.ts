import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { nowIso } from "./projects";
import {
  recordArtifactSetSchema,
  type ArtifactFilename,
  type RecordArtifactSetInput,
} from "./schemas";
import { LedgerValidationError } from "./statements";

// The export gate is an expected condition of normal use, not an invalid
// write, so it gets its own type for a safe UI message.
export class ExportNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportNotReadyError";
  }
}

export type ArtifactVersionRow = {
  id: string;
  session_id: string;
  artifact_set_id: string;
  filename: ArtifactFilename;
  body: string;
  created_at: string;
};

// There are intentionally no update or delete functions in this module:
// version rows are append-only evidence, enforced again by database triggers.
export function recordArtifactSet(
  db: Database.Database,
  input: RecordArtifactSetInput,
): ArtifactVersionRow[] {
  const parsed = recordArtifactSetSchema.safeParse(input);
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const session = db
    .prepare("SELECT id FROM discovery_sessions WHERE id = ?")
    .get(parsed.data.sessionId) as { id: string } | undefined;
  if (!session) {
    throw new LedgerValidationError(
      `Session ${parsed.data.sessionId} not found`,
    );
  }

  const approvedCount = db
    .prepare(
      "SELECT COUNT(*) AS n FROM statements WHERE session_id = ? AND status = 'approved'",
    )
    .get(parsed.data.sessionId) as { n: number };
  if (approvedCount.n === 0) {
    throw new ExportNotReadyError(
      `Session ${parsed.data.sessionId} has no approved statements to export`,
    );
  }

  const artifactSetId = randomUUID();
  const createdAt = nowIso();

  const run = db.transaction(() => {
    for (const file of parsed.data.files) {
      db.prepare(
        `INSERT INTO artifact_versions (
          id, session_id, artifact_set_id, filename, body, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        parsed.data.sessionId,
        artifactSetId,
        file.filename,
        file.body,
        createdAt,
      );
    }
    return listArtifactVersions(db, parsed.data.sessionId).filter(
      (row) => row.artifact_set_id === artifactSetId,
    );
  });

  try {
    return run();
  } catch (error) {
    if (
      error instanceof LedgerValidationError ||
      error instanceof ExportNotReadyError
    ) {
      throw error;
    }
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Artifact set write failed",
    );
  }
}

export function getArtifactVersion(
  db: Database.Database,
  id: string,
): ArtifactVersionRow {
  const row = db
    .prepare("SELECT * FROM artifact_versions WHERE id = ?")
    .get(id) as ArtifactVersionRow | undefined;
  if (!row) {
    throw new LedgerValidationError(`Artifact version ${id} not found`);
  }
  return row;
}

export function listArtifactVersions(
  db: Database.Database,
  sessionId: string,
): ArtifactVersionRow[] {
  // rowid breaks created_at ties so insertion order stays chronological even
  // when two generations land in the same millisecond.
  return db
    .prepare(
      "SELECT * FROM artifact_versions WHERE session_id = ? ORDER BY created_at, rowid",
    )
    .all(sessionId) as ArtifactVersionRow[];
}
