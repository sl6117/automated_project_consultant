import type Database from "better-sqlite3";

export class CostCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostCapError";
  }
}

export function applyEstimatedCost(
  db: Database.Database,
  sessionId: string,
  deltaCents: number,
  options: { confirmedOverCap?: boolean } = {},
): { estimatedCostCents: number; capCents: number } {
  if (!Number.isInteger(deltaCents) || deltaCents < 0) {
    throw new CostCapError("Cost delta must be a non-negative integer");
  }

  const session = db
    .prepare(
      "SELECT estimated_cost_cents, cap_cents FROM discovery_sessions WHERE id = ?",
    )
    .get(sessionId) as
    | { estimated_cost_cents: number; cap_cents: number }
    | undefined;

  if (!session) {
    throw new CostCapError(`Session ${sessionId} not found`);
  }

  const next = session.estimated_cost_cents + deltaCents;
  if (next > session.cap_cents && !options.confirmedOverCap) {
    throw new CostCapError(
      `Call would exceed the session cap of ${session.cap_cents} cents`,
    );
  }

  db.prepare(
    "UPDATE discovery_sessions SET estimated_cost_cents = ? WHERE id = ?",
  ).run(next, sessionId);

  return { estimatedCostCents: next, capCents: session.cap_cents };
}
