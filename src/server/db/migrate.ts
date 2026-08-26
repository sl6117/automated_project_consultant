import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

export function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row) => (row as { id: number }).id),
  );

  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();

  for (const file of files) {
    const id = Number(file.slice(0, file.indexOf("_")));
    if (applied.has(id)) {
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
      ).run(id, new Date().toISOString());
    });
    run();
  }
}
