import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_SESSION_CAP_CENTS,
  MICROCENTS_PER_CENT,
} from "../model/config";

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
  // Sessions begin 'starting'; the atomic content commit of extraction plus
  // first question flips them to 'active'.
  db.prepare(
    `INSERT INTO discovery_sessions (
      id, project_id, estimated_cost_cents, cap_cents, cap_microcents,
      initialization_status, created_at
    ) VALUES (?, ?, 0, ?, ?, 'starting', ?)`,
  ).run(id, projectId, capCents, capCents * MICROCENTS_PER_CENT, nowIso());
  return { id };
}
