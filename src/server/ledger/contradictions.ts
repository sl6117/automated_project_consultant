import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { nowIso } from "./projects";
import {
  contradictionIdSchema,
  type ContradictionOutput,
  type EditStatementInput,
} from "./schemas";
import {
  LedgerValidationError,
  retractApprovedStatement,
  reviseApprovedStatement,
  type StatementRow,
} from "./statements";

// A contradiction is a model-surfaced tension between approved statements.
// The model may only ADD rows; it never closes, edits, or deletes one. The
// two close paths are both explicit user actions: dismiss records "the
// tension was never real"; retracting or revising a cited statement records
// "the tension was real and the canon changed", which resolves every open
// row citing that statement. Closed rows persist as provenance.

export type ContradictionStatus = "open" | "dismissed" | "resolved";

export type ContradictionRow = {
  id: string;
  session_id: string;
  model_call_id: string | null;
  summary: string;
  cited_statement_ids: string;
  status: ContradictionStatus;
  created_at: string;
  closed_at: string | null;
};

export function citedStatementIdsOf(row: ContradictionRow): string[] {
  return JSON.parse(row.cited_statement_ids) as string[];
}

function duplicateKey(summary: string, citedIds: string[]): string {
  return JSON.stringify([summary, [...citedIds].sort()]);
}

// Plain inserts with no transaction of their own: the adaptive ask composes
// them with the candidate and question inserts into one atomic commit. A new
// pass never deletes existing rows; a payload row that exactly matches a
// still-open one (same summary, same cited set) is skipped so the same open
// tension does not accumulate once per pass. Returns the number inserted.
export function insertContradictions(
  db: Database.Database,
  input: {
    sessionId: string;
    modelCallId: string | null;
    contradictions: ContradictionOutput[];
  },
): number {
  const openKeys = new Set(
    listContradictions(db, input.sessionId, "open").map((row) =>
      duplicateKey(row.summary, citedStatementIdsOf(row)),
    ),
  );

  const insert = db.prepare(
    `INSERT INTO contradictions (
      id, session_id, model_call_id, summary, cited_statement_ids, status,
      created_at, closed_at
    ) VALUES (?, ?, ?, ?, ?, 'open', ?, NULL)`,
  );
  const createdAt = nowIso();
  let inserted = 0;
  try {
    for (const contradiction of input.contradictions) {
      const key = duplicateKey(
        contradiction.summary,
        contradiction.citedStatementIds,
      );
      if (openKeys.has(key)) {
        continue;
      }
      insert.run(
        randomUUID(),
        input.sessionId,
        input.modelCallId,
        contradiction.summary,
        JSON.stringify(contradiction.citedStatementIds),
        createdAt,
      );
      openKeys.add(key);
      inserted += 1;
    }
  } catch (error) {
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Contradiction insert failed",
    );
  }
  return inserted;
}

export function listContradictions(
  db: Database.Database,
  sessionId: string,
  status?: ContradictionStatus,
): ContradictionRow[] {
  if (status) {
    return db
      .prepare(
        "SELECT * FROM contradictions WHERE session_id = ? AND status = ? ORDER BY created_at, rowid",
      )
      .all(sessionId, status) as ContradictionRow[];
  }
  return db
    .prepare(
      "SELECT * FROM contradictions WHERE session_id = ? ORDER BY created_at, rowid",
    )
    .all(sessionId) as ContradictionRow[];
}

export function getContradiction(
  db: Database.Database,
  id: string,
): ContradictionRow {
  const row = db
    .prepare("SELECT * FROM contradictions WHERE id = ?")
    .get(id) as ContradictionRow | undefined;
  if (!row) {
    throw new LedgerValidationError(`Contradiction ${id} not found`);
  }
  return row;
}

export function dismissContradiction(
  db: Database.Database,
  contradictionId: string,
): ContradictionRow {
  const parsed = contradictionIdSchema.safeParse({ contradictionId });
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const current = getContradiction(db, parsed.data.contradictionId);
  if (current.status !== "open") {
    throw new LedgerValidationError(
      `Contradiction ${current.id} is ${current.status}, not open`,
    );
  }

  db.prepare(
    "UPDATE contradictions SET status = 'dismissed', closed_at = ? WHERE id = ?",
  ).run(nowIso(), current.id);
  return getContradiction(db, current.id);
}

// The canon changed under the tension: every open contradiction in this
// session citing the statement is resolved. Session-scoped structurally, not
// just via UUID uniqueness. This rides on an explicit user statement action —
// nothing here runs on model output.
export function resolveContradictionsCitingStatement(
  db: Database.Database,
  sessionId: string,
  statementId: string,
): number {
  const open = listContradictions(db, sessionId, "open");
  const closedAt = nowIso();
  let resolved = 0;
  for (const row of open) {
    if (!citedStatementIdsOf(row).includes(statementId)) {
      continue;
    }
    db.prepare(
      "UPDATE contradictions SET status = 'resolved', closed_at = ? WHERE id = ?",
    ).run(closedAt, row.id);
    resolved += 1;
  }
  return resolved;
}

// The tension-resolution path supersedes only statements an open tension
// actually cites: general re-litigation of approved statements is not what
// this path is for, and the ledger enforces that rather than trusting the UI.
function requireOpenCitation(
  db: Database.Database,
  statementId: string,
): { sessionId: string } {
  const statement = db
    .prepare("SELECT id, session_id FROM statements WHERE id = ?")
    .get(statementId) as { id: string; session_id: string } | undefined;
  if (!statement) {
    throw new LedgerValidationError(`Statement ${statementId} not found`);
  }
  const cited = listContradictions(db, statement.session_id, "open").some(
    (row) => citedStatementIdsOf(row).includes(statementId),
  );
  if (!cited) {
    throw new LedgerValidationError(
      `Statement ${statementId} is not cited by an open tension`,
    );
  }
  return { sessionId: statement.session_id };
}

export function retractCitedStatement(
  db: Database.Database,
  statementId: string,
): { statement: StatementRow; resolvedContradictions: number } {
  const run = db.transaction(() => {
    const { sessionId } = requireOpenCitation(db, statementId);
    const statement = retractApprovedStatement(db, statementId);
    const resolvedContradictions = resolveContradictionsCitingStatement(
      db,
      sessionId,
      statementId,
    );
    return { statement, resolvedContradictions };
  });
  return run();
}

export function reviseCitedStatement(
  db: Database.Database,
  input: EditStatementInput,
): {
  original: StatementRow;
  revised: StatementRow;
  resolvedContradictions: number;
} {
  const run = db.transaction(() => {
    const { sessionId } = requireOpenCitation(db, input.statementId);
    const { original, revised } = reviseApprovedStatement(db, input);
    const resolvedContradictions = resolveContradictionsCitingStatement(
      db,
      sessionId,
      original.id,
    );
    return { original, revised, resolvedContradictions };
  });
  return run();
}
