import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { nowIso } from "./projects";
import {
  concernIdSchema,
  editConcernSchema,
  proposeConcernSchema,
  type EditConcernInput,
  type ProposeConcernInput,
  type ReviewStatus,
} from "./schemas";
import { LedgerValidationError } from "./statements";

export type ConcernRow = {
  id: string;
  session_id: string;
  code: string;
  coverage: string;
  status: ReviewStatus;
  provenance_source: "user" | "model-inference";
  model_call_id: string | null;
  revises_concern_id: string | null;
  created_at: string;
};

export function proposeConcern(
  db: Database.Database,
  input: ProposeConcernInput,
): ConcernRow {
  const parsed = proposeConcernSchema.safeParse(input);
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const id = randomUUID();
  try {
    db.prepare(
      `INSERT INTO concerns (
        id, session_id, code, coverage, status, provenance_source, model_call_id, created_at
      ) VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?)`,
    ).run(
      id,
      parsed.data.sessionId,
      parsed.data.code,
      parsed.data.coverage,
      parsed.data.provenanceSource,
      parsed.data.modelCallId ?? null,
      nowIso(),
    );
  } catch (error) {
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Concern write failed",
    );
  }

  return getConcern(db, id);
}

function transitionProposedConcern(
  db: Database.Database,
  concernId: string,
  to: "approved" | "rejected",
): ConcernRow {
  const parsed = concernIdSchema.safeParse({ concernId });
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const current = getConcern(db, parsed.data.concernId);
  if (current.status !== "proposed") {
    throw new LedgerValidationError(
      `Concern ${parsed.data.concernId} is ${current.status}, not proposed`,
    );
  }

  db.prepare("UPDATE concerns SET status = ? WHERE id = ?").run(
    to,
    parsed.data.concernId,
  );
  return getConcern(db, parsed.data.concernId);
}

export function approveConcern(
  db: Database.Database,
  concernId: string,
): ConcernRow {
  return transitionProposedConcern(db, concernId, "approved");
}

export function rejectConcern(
  db: Database.Database,
  concernId: string,
): ConcernRow {
  return transitionProposedConcern(db, concernId, "rejected");
}

export function editConcern(
  db: Database.Database,
  input: EditConcernInput,
): { original: ConcernRow; revised: ConcernRow } {
  const parsed = editConcernSchema.safeParse(input);
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const run = db.transaction(() => {
    const original = rejectConcern(db, parsed.data.concernId);

    const id = randomUUID();
    db.prepare(
      `INSERT INTO concerns (
        id, session_id, code, coverage, status, provenance_source, model_call_id,
        revises_concern_id, created_at
      ) VALUES (?, ?, ?, ?, 'approved', 'user', NULL, ?, ?)`,
    ).run(
      id,
      original.session_id,
      original.code,
      parsed.data.coverage,
      original.id,
      nowIso(),
    );

    return { original, revised: getConcern(db, id) };
  });

  try {
    return run();
  } catch (error) {
    if (error instanceof LedgerValidationError) {
      throw error;
    }
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Concern edit failed",
    );
  }
}

export function listConcerns(
  db: Database.Database,
  sessionId: string,
  status?: ReviewStatus,
): ConcernRow[] {
  if (status) {
    return db
      .prepare(
        "SELECT * FROM concerns WHERE session_id = ? AND status = ? ORDER BY created_at",
      )
      .all(sessionId, status) as ConcernRow[];
  }

  return db
    .prepare("SELECT * FROM concerns WHERE session_id = ? ORDER BY created_at")
    .all(sessionId) as ConcernRow[];
}

function getConcern(db: Database.Database, id: string): ConcernRow {
  const row = db
    .prepare("SELECT * FROM concerns WHERE id = ?")
    .get(id) as ConcernRow | undefined;
  if (!row) {
    throw new LedgerValidationError(`Concern ${id} not found`);
  }
  return row;
}
