import type Database from "better-sqlite3";

// Async alone does not make "model call inside a transaction" impossible: a
// manual BEGIN via db.exec, or a promise fired without awaiting, can still
// interleave model I/O with an open transaction. This guard runs immediately
// before every model client call to enforce the structure at runtime.
export function assertNoOpenTransaction(db: Database.Database): void {
  if (db.inTransaction) {
    throw new Error(
      "Model calls must not run while a database transaction is open",
    );
  }
}
