import { onTestFinished } from "vitest";
import type Database from "better-sqlite3";
import { openMemoryLedger } from "../../../src/server/db/open";

// Every test-owned better-sqlite3 handle must close when its test ends: an
// open native handle at worker teardown crashes vitest's forks pool on
// Linux CI (the workaround was --pool=threads; the fix is closing what we
// open). onTestFinished runs for passing and failing tests alike.
export function openTestLedger(): Database.Database {
  const db = openMemoryLedger();
  onTestFinished(() => {
    if (db.open) {
      db.close();
    }
  });
  return db;
}
