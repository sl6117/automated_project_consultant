import Database from "better-sqlite3";
import { applyMigrations } from "./migrate";

export function openLedger(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}

export function openMemoryLedger(): Database.Database {
  return openLedger(":memory:");
}
