import { mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type Database from "better-sqlite3";
import { openLedger } from "./open";

let appDb: Database.Database | undefined;

export function getLedgerPath(): string {
  const file = basename(process.env.LEDGER_FILE ?? "consultant.sqlite");
  return join(process.cwd(), "data", file);
}

export function getAppDb(): Database.Database {
  if (!appDb) {
    const path = getLedgerPath();
    mkdirSync(join(process.cwd(), "data"), { recursive: true });
    appDb = openLedger(path);
  }
  return appDb;
}
