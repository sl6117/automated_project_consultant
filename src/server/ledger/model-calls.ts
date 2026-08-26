import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { applyEstimatedCost } from "./cost";
import { nowIso } from "./projects";
import { recordModelCallSchema, type RecordModelCallInput } from "./schemas";
import { LedgerValidationError } from "./statements";

export type ModelCallRow = {
  id: string;
  session_id: string;
  model_alias: string;
  recorded: number;
  execution_provenance: "synthetic" | "recorded" | "live";
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_cents: number;
  created_at: string;
};

export function recordModelCall(
  db: Database.Database,
  input: RecordModelCallInput,
): ModelCallRow {
  const parsed = recordModelCallSchema.safeParse(input);
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const run = db.transaction(() => {
    applyEstimatedCost(db, parsed.data.sessionId, parsed.data.estimatedCostCents, {
      confirmedOverCap: parsed.data.confirmedOverCap,
    });

    const id = randomUUID();
    // The legacy recorded boolean is derived here and nowhere else: it means
    // "no live spend", so only a live call clears it.
    const recorded = parsed.data.executionProvenance === "live" ? 0 : 1;
    db.prepare(
      `INSERT INTO model_calls (
        id, session_id, model_alias, recorded, execution_provenance,
        input_tokens, output_tokens, estimated_cost_cents, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      parsed.data.sessionId,
      parsed.data.modelAlias,
      recorded,
      parsed.data.executionProvenance,
      parsed.data.inputTokens ?? null,
      parsed.data.outputTokens ?? null,
      parsed.data.estimatedCostCents,
      nowIso(),
    );

    return db
      .prepare("SELECT * FROM model_calls WHERE id = ?")
      .get(id) as ModelCallRow;
  });

  return run();
}
