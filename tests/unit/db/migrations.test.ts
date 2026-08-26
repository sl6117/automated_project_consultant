import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const migrationsDir = join(process.cwd(), "src/server/db/migrations");

function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
}

// Mirrors applyMigrations: each migration runs inside one transaction.
function applyMigration(db: Database.Database, file: string): void {
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  db.transaction(() => db.exec(sql))();
}

function openLedgerBeforeMigration(id: number): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const file of migrationFiles()) {
    if (Number(file.slice(0, file.indexOf("_"))) >= id) {
      continue;
    }
    applyMigration(db, file);
  }
  return db;
}

function columnNames(db: Database.Database, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  ).map((row) => row.name);
}

describe("migration 005_coach_notes", () => {
  test("refuses to replace a legacy coach_notes table that holds rows", () => {
    const db = openLedgerBeforeMigration(5);
    db.prepare(
      "INSERT INTO projects (id, name, created_at) VALUES ('p1', 'Legacy', 't0')",
    ).run();
    db.prepare(
      "INSERT INTO discovery_sessions (id, project_id, created_at) VALUES ('s1', 'p1', 't0')",
    ).run();
    db.prepare(
      "INSERT INTO coach_notes (id, session_id, body, created_at) VALUES ('c1', 's1', 'legacy advice', 't0')",
    ).run();

    expect(() => applyMigration(db, "005_coach_notes.sql")).toThrow(/CHECK/);

    const columns = columnNames(db, "coach_notes");
    expect(columns).toContain("body");
    expect(columns).not.toContain("recommendation");
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM coach_notes")
      .get() as { n: number };
    expect(count.n).toBe(1);
    expect(columnNames(db, "statements")).not.toContain(
      "promoted_from_coach_note_id",
    );
  });

  test("replaces an empty legacy table with the structured schema", () => {
    const db = openLedgerBeforeMigration(5);

    applyMigration(db, "005_coach_notes.sql");

    const columns = columnNames(db, "coach_notes");
    expect(columns).toContain("recommendation");
    expect(columns).toContain("confidence");
    expect(columns).toContain("evidence_would_change");
    expect(columns).not.toContain("body");
    expect(columnNames(db, "statements")).toContain(
      "promoted_from_coach_note_id",
    );
  });
});
