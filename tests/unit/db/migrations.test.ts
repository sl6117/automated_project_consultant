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

describe("migration 006_artifact_sets", () => {
  test("refuses to replace a legacy artifact_versions table that holds rows", () => {
    const db = openLedgerBeforeMigration(6);
    db.prepare(
      "INSERT INTO projects (id, name, created_at) VALUES ('p1', 'Legacy', 't0')",
    ).run();
    db.prepare(
      "INSERT INTO discovery_sessions (id, project_id, created_at) VALUES ('s1', 'p1', 't0')",
    ).run();
    db.prepare(
      "INSERT INTO artifact_versions (id, session_id, filename, body, created_at) VALUES ('a1', 's1', 'SPEC.md', 'legacy body', 't0')",
    ).run();

    expect(() => applyMigration(db, "006_artifact_sets.sql")).toThrow(/CHECK/);

    expect(columnNames(db, "artifact_versions")).not.toContain(
      "artifact_set_id",
    );
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM artifact_versions")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  test("replaces an empty legacy table and installs immutability triggers", () => {
    const db = openLedgerBeforeMigration(6);

    applyMigration(db, "006_artifact_sets.sql");

    expect(columnNames(db, "artifact_versions")).toContain("artifact_set_id");
    const triggers = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'artifact_versions'",
        )
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(triggers).toContain("artifact_versions_immutable_update");
    expect(triggers).toContain("artifact_versions_immutable_delete");
  });
});

describe("migration 007_live_model_attempts", () => {
  test("is additive: linked rows keep their ids and foreign keys stay clean", () => {
    const db = openLedgerBeforeMigration(7);
    db.prepare(
      "INSERT INTO projects (id, name, idea, created_at) VALUES ('p1', 'Linked', 'idea', 't0')",
    ).run();
    db.prepare(
      `INSERT INTO discovery_sessions (
        id, project_id, estimated_cost_cents, cap_cents, created_at
      ) VALUES ('s1', 'p1', 40, 500, 't0')`,
    ).run();
    db.prepare(
      `INSERT INTO model_calls (
        id, session_id, model_alias, recorded, estimated_cost_cents,
        created_at, execution_provenance
      ) VALUES ('call-1', 's1', 'sonnet', 1, 40, 't0', 'recorded')`,
    ).run();
    db.prepare(
      `INSERT INTO statements (
        id, session_id, kind, status, body, provenance_source, model_call_id, created_at
      ) VALUES ('st1', 's1', 'fact', 'proposed', 'linked fact', 'model-inference', 'call-1', 't0')`,
    ).run();
    db.prepare(
      `INSERT INTO questions (
        id, session_id, body, why_selected, status, provenance_source, model_call_id, created_at
      ) VALUES ('q1', 's1', 'Q?', 'why', 'pending', 'model-inference', 'call-1', 't0')`,
    ).run();
    db.prepare(
      `INSERT INTO coach_notes (
        id, session_id, question_id, recommendation, why_now, technique,
        tradeoffs, gotcha, confidence, evidence_would_change,
        provenance_source, model_call_id, created_at
      ) VALUES ('cn1', 's1', 'q1', 'rec', 'now', 'tech', 'trade', 'gotcha',
        'low', 'evidence', 'model-inference', 'call-1', 't0')`,
    ).run();

    applyMigration(db, "007_live_model_attempts.sql");

    expect(db.prepare("PRAGMA foreign_key_check").all()).toStrictEqual([]);

    const call = db
      .prepare("SELECT * FROM model_calls WHERE id = 'call-1'")
      .get() as {
      id: string;
      status: string;
      estimated_cost_microcents: number;
      actual_cost_microcents: number;
    };
    expect(call.id).toBe("call-1");
    expect(call.status).toBe("succeeded");
    expect(call.estimated_cost_microcents).toBe(40_000_000);
    expect(call.actual_cost_microcents).toBe(40_000_000);

    const session = db
      .prepare("SELECT * FROM discovery_sessions WHERE id = 's1'")
      .get() as { initialization_status: string; cap_microcents: number };
    expect(session.initialization_status).toBe("active");
    expect(session.cap_microcents).toBe(500_000_000);

    const links = db
      .prepare(
        `SELECT
           (SELECT model_call_id FROM statements WHERE id = 'st1') AS s,
           (SELECT model_call_id FROM questions WHERE id = 'q1') AS q,
           (SELECT model_call_id FROM coach_notes WHERE id = 'cn1') AS c`,
      )
      .get() as { s: string; q: string; c: string };
    expect(links).toStrictEqual({ s: "call-1", q: "call-1", c: "call-1" });
  });
});
