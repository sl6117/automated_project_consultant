import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { DEFAULT_SESSION_CAP_CENTS } from "../model/config";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createProject(
  db: Database.Database,
  name: string,
  idea: string = "",
): { id: string } {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO projects (id, name, idea, created_at) VALUES (?, ?, ?, ?)",
  ).run(id, name, idea, nowIso());
  return { id };
}

export function createSession(
  db: Database.Database,
  projectId: string,
  capCents: number = DEFAULT_SESSION_CAP_CENTS,
): { id: string } {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO discovery_sessions (
      id, project_id, estimated_cost_cents, cap_cents, created_at
    ) VALUES (?, ?, 0, ?, ?)`,
  ).run(id, projectId, capCents, nowIso());
  return { id };
}
