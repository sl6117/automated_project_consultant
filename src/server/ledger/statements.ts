import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { nowIso } from "./projects";
import {
  editStatementSchema,
  proposeStatementSchema,
  statementIdSchema,
  type EditStatementInput,
  type ProposeStatementInput,
  type ReviewStatus,
  type StatementKind,
} from "./schemas";

export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerValidationError";
  }
}

export type StatementRow = {
  id: string;
  session_id: string;
  kind: StatementKind;
  status: ReviewStatus;
  body: string;
  provenance_source: "user" | "model-inference";
  model_call_id: string | null;
  revises_statement_id: string | null;
  promoted_from_coach_note_id: string | null;
  created_at: string;
};

export function proposeStatement(
  db: Database.Database,
  input: ProposeStatementInput,
): StatementRow {
  const parsed = proposeStatementSchema.safeParse(input);
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const id = randomUUID();
  const createdAt = nowIso();

  try {
    db.prepare(
      `INSERT INTO statements (
        id, session_id, kind, status, body, provenance_source, model_call_id, created_at
      ) VALUES (?, ?, ?, 'proposed', ?, ?, ?, ?)`,
    ).run(
      id,
      parsed.data.sessionId,
      parsed.data.kind,
      parsed.data.body,
      parsed.data.provenanceSource,
      parsed.data.modelCallId ?? null,
      createdAt,
    );
  } catch (error) {
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Statement write failed",
    );
  }

  return getStatement(db, id);
}

function transitionProposedStatement(
  db: Database.Database,
  statementId: string,
  to: "approved" | "rejected",
): StatementRow {
  const parsed = statementIdSchema.safeParse({ statementId });
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const current = getStatement(db, parsed.data.statementId);
  if (current.status !== "proposed") {
    throw new LedgerValidationError(
      `Statement ${parsed.data.statementId} is ${current.status}, not proposed`,
    );
  }

  db.prepare("UPDATE statements SET status = ? WHERE id = ?").run(
    to,
    parsed.data.statementId,
  );
  return getStatement(db, parsed.data.statementId);
}

export function approveStatement(
  db: Database.Database,
  statementId: string,
): StatementRow {
  return transitionProposedStatement(db, statementId, "approved");
}

export function rejectStatement(
  db: Database.Database,
  statementId: string,
): StatementRow {
  return transitionProposedStatement(db, statementId, "rejected");
}

export function editStatement(
  db: Database.Database,
  input: EditStatementInput,
): { original: StatementRow; revised: StatementRow } {
  const parsed = editStatementSchema.safeParse(input);
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const run = db.transaction(() => {
    const original = rejectStatement(db, parsed.data.statementId);

    const id = randomUUID();
    db.prepare(
      `INSERT INTO statements (
        id, session_id, kind, status, body, provenance_source, model_call_id,
        revises_statement_id, created_at
      ) VALUES (?, ?, ?, 'approved', ?, 'user', NULL, ?, ?)`,
    ).run(
      id,
      original.session_id,
      original.kind,
      parsed.data.body,
      original.id,
      nowIso(),
    );

    return { original, revised: getStatement(db, id) };
  });

  try {
    return run();
  } catch (error) {
    if (error instanceof LedgerValidationError) {
      throw error;
    }
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Statement edit failed",
    );
  }
}

// Phase 2 tension resolution needs a user-owned supersession path for
// APPROVED statements: the proposed-row transitions above never touch a
// reviewed row, but a cited statement in an open contradiction is approved by
// definition. Retracting rejects it outright; revising rejects it and
// approves the user's replacement with the same revises link the proposed
// edit path uses. Both are explicit user actions — models have no path here.
export function retractApprovedStatement(
  db: Database.Database,
  statementId: string,
): StatementRow {
  const parsed = statementIdSchema.safeParse({ statementId });
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const current = getStatement(db, parsed.data.statementId);
  if (current.status !== "approved") {
    throw new LedgerValidationError(
      `Statement ${parsed.data.statementId} is ${current.status}, not approved`,
    );
  }

  db.prepare("UPDATE statements SET status = 'rejected' WHERE id = ?").run(
    parsed.data.statementId,
  );
  return getStatement(db, parsed.data.statementId);
}

export function reviseApprovedStatement(
  db: Database.Database,
  input: EditStatementInput,
): { original: StatementRow; revised: StatementRow } {
  const parsed = editStatementSchema.safeParse(input);
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const run = db.transaction(() => {
    const original = retractApprovedStatement(db, parsed.data.statementId);

    const id = randomUUID();
    db.prepare(
      `INSERT INTO statements (
        id, session_id, kind, status, body, provenance_source, model_call_id,
        revises_statement_id, created_at
      ) VALUES (?, ?, ?, 'approved', ?, 'user', NULL, ?, ?)`,
    ).run(
      id,
      original.session_id,
      original.kind,
      parsed.data.body,
      original.id,
      nowIso(),
    );

    return { original, revised: getStatement(db, id) };
  });

  try {
    return run();
  } catch (error) {
    if (error instanceof LedgerValidationError) {
      throw error;
    }
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Statement revision failed",
    );
  }
}

export function listStatements(
  db: Database.Database,
  sessionId: string,
  status?: ReviewStatus,
): StatementRow[] {
  if (status) {
    return db
      .prepare(
        "SELECT * FROM statements WHERE session_id = ? AND status = ? ORDER BY created_at",
      )
      .all(sessionId, status) as StatementRow[];
  }

  return db
    .prepare("SELECT * FROM statements WHERE session_id = ? ORDER BY created_at")
    .all(sessionId) as StatementRow[];
}

function getStatement(db: Database.Database, id: string): StatementRow {
  const row = db
    .prepare("SELECT * FROM statements WHERE id = ?")
    .get(id) as StatementRow | undefined;
  if (!row) {
    throw new LedgerValidationError(`Statement ${id} not found`);
  }
  return row;
}
