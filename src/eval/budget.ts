import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";

// Durable phase-budget accounting (spec, slice 4). The $15 Phase 3 cap is
// aggregated in one committed, append-only record: eval/budget.jsonl. Every
// live call is two-phase — a reservation entry is appended and fsync'd
// BEFORE the request is sent, and a settlement follows it — so a crash
// between the two can only under-state the remaining budget, never
// over-state it. Missing, corrupt, or truncated state FAILS CLOSED: live
// capture refuses to start, and an absent record is never treated as fresh
// authorization — budget exists only because an explicit owner authorization
// entry granted it. Deleting the file destroys history like any deletion;
// it cannot create budget, because a missing record blocks spending rather
// than resetting it.

export const PHASE_BUDGET_CAP_MICROCENTS = 1_500_000_000; // $15.00
export const PER_BRIEF_CONSULTANT_CAP_MICROCENTS = 150_000_000; // $1.50

const authorizationEntrySchema = z.strictObject({
  kind: z.literal("authorization"),
  at: z.string().min(1),
  capMicrocents: z.number().int().positive(),
  note: z.string().min(1),
});

const reservationEntrySchema = z.strictObject({
  kind: z.literal("reservation"),
  id: z.string().min(1),
  at: z.string().min(1),
  runId: z.string().min(1),
  briefId: z.string().min(1),
  role: z.enum(["consultant", "judge"]),
  estimateMicrocents: z.number().int().min(0),
});

const settlementEntrySchema = z.strictObject({
  kind: z.literal("settlement"),
  at: z.string().min(1),
  reservationId: z.string().min(1),
  outcome: z.enum(["succeeded", "transport_failed", "validation_failed"]),
  // Transport failures never learned their real spend; their reservation
  // stays counted at its estimate and no actual may be claimed.
  actualMicrocents: z.number().int().min(0).optional(),
});

const budgetEntrySchema = z.discriminatedUnion("kind", [
  authorizationEntrySchema,
  reservationEntrySchema,
  settlementEntrySchema,
]);

export type BudgetEntry = z.infer<typeof budgetEntrySchema>;

export class BudgetIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetIntegrityError";
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export type BudgetState = {
  capMicrocents: number;
  settledActualMicrocents: number;
  // Reservations with no settlement, plus transport failures, at estimates.
  unresolvedReservationMicrocents: number;
  remainingMicrocents: number;
  consultantSettledMicrocents: number;
  judgeSettledMicrocents: number;
  entries: BudgetEntry[];
};

// Reads and verifies the whole record. Any malformed line — including a
// truncated final line from a crash mid-append — rejects the record; the
// owner restores it from git history rather than the harness guessing.
export function readBudget(path: string): BudgetState {
  if (!existsSync(path)) {
    throw new BudgetIntegrityError(
      `Budget record ${path} does not exist. An absent record is not fresh authorization: restore it from git history, or the owner explicitly initializes a new one.`,
    );
  }
  const text = readFileSync(path, "utf8");
  const entries: BudgetEntry[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new BudgetIntegrityError(
        `Budget record line ${index + 1} is not valid JSON (truncated write?); restore the record from git history`,
      );
    }
    const entry = budgetEntrySchema.safeParse(parsed);
    if (!entry.success) {
      throw new BudgetIntegrityError(
        `Budget record line ${index + 1} is invalid: ${entry.error.message}`,
      );
    }
    entries.push(entry.data);
  }

  if (entries.length === 0 || entries[0]!.kind !== "authorization") {
    throw new BudgetIntegrityError(
      "Budget record must begin with an owner authorization entry",
    );
  }

  let cap = 0;
  const reservations = new Map<
    string,
    z.infer<typeof reservationEntrySchema>
  >();
  const settledIds = new Set<string>();
  let settledActual = 0;
  let unresolved = 0;
  let consultantSettled = 0;
  let judgeSettled = 0;

  for (const entry of entries) {
    if (entry.kind === "authorization") {
      cap += entry.capMicrocents;
      continue;
    }
    if (entry.kind === "reservation") {
      if (reservations.has(entry.id)) {
        throw new BudgetIntegrityError(
          `Duplicate reservation id ${entry.id} in budget record`,
        );
      }
      reservations.set(entry.id, entry);
      continue;
    }
    const reservation = reservations.get(entry.reservationId);
    if (!reservation) {
      throw new BudgetIntegrityError(
        `Settlement references unknown reservation ${entry.reservationId}`,
      );
    }
    if (settledIds.has(entry.reservationId)) {
      throw new BudgetIntegrityError(
        `Reservation ${entry.reservationId} settled twice`,
      );
    }
    if (entry.outcome === "transport_failed") {
      if (entry.actualMicrocents !== undefined) {
        throw new BudgetIntegrityError(
          `Transport-failed settlement for ${entry.reservationId} claims an actual cost it cannot know`,
        );
      }
    } else if (entry.actualMicrocents === undefined) {
      throw new BudgetIntegrityError(
        `Settlement for ${entry.reservationId} (${entry.outcome}) is missing its actual cost`,
      );
    }
    settledIds.add(entry.reservationId);
    if (entry.outcome !== "transport_failed") {
      settledActual += entry.actualMicrocents!;
      if (reservation.role === "consultant") {
        consultantSettled += entry.actualMicrocents!;
      } else {
        judgeSettled += entry.actualMicrocents!;
      }
    }
  }

  for (const [id, reservation] of reservations) {
    if (!settledIds.has(id)) {
      unresolved += reservation.estimateMicrocents;
    }
  }
  // Transport failures stay reserved at their estimates: real spend unknown.
  for (const entry of entries) {
    if (
      entry.kind === "settlement" &&
      entry.outcome === "transport_failed"
    ) {
      unresolved += reservations.get(entry.reservationId)!.estimateMicrocents;
    }
  }

  return {
    capMicrocents: cap,
    settledActualMicrocents: settledActual,
    unresolvedReservationMicrocents: unresolved,
    remainingMicrocents: cap - settledActual - unresolved,
    consultantSettledMicrocents: consultantSettled,
    judgeSettledMicrocents: judgeSettled,
    entries,
  };
}

// Appends one line and flushes it to disk before returning — the durability
// the two-phase contract depends on.
function appendDurably(path: string, entry: BudgetEntry): void {
  const fd = openSync(path, "a");
  try {
    writeSync(fd, JSON.stringify(entry) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

// Only an explicit owner action creates a budget record, and never over an
// existing one.
export function initializeBudget(
  path: string,
  input: { capMicrocents: number; note: string },
): void {
  if (existsSync(path)) {
    throw new BudgetIntegrityError(
      `Budget record ${path} already exists; new authorization appends, it does not replace`,
    );
  }
  appendDurably(path, {
    kind: "authorization",
    at: new Date().toISOString(),
    capMicrocents: input.capMicrocents,
    note: input.note,
  });
}

export function appendAuthorization(
  path: string,
  input: { capMicrocents: number; note: string },
): void {
  readBudget(path); // fail closed on a broken record before appending
  appendDurably(path, {
    kind: "authorization",
    at: new Date().toISOString(),
    capMicrocents: input.capMicrocents,
    note: input.note,
  });
}

// Reserves budget for one live call: refuses when the estimate does not fit
// the remaining budget, appends durably otherwise, and returns the
// reservation id the settlement must reference.
export function reserveSpend(
  path: string,
  input: {
    runId: string;
    briefId: string;
    role: "consultant" | "judge";
    estimateMicrocents: number;
  },
): string {
  const state = readBudget(path);
  if (input.estimateMicrocents > state.remainingMicrocents) {
    throw new BudgetExceededError(
      `Reserving ${input.estimateMicrocents} microcents exceeds the remaining phase budget of ${state.remainingMicrocents}; new explicit owner authorization is required`,
    );
  }
  const id = randomUUID();
  appendDurably(path, {
    kind: "reservation",
    id,
    at: new Date().toISOString(),
    runId: input.runId,
    briefId: input.briefId,
    role: input.role,
    estimateMicrocents: input.estimateMicrocents,
  });
  return id;
}

// Note on outcomes: today's writers settle `succeeded` (cost known from
// usage) or `transport_failed` (cost unknown; reservation stays at its
// estimate). A payload that later fails Zod validation still settled
// `succeeded` here, because the API call completed and its cost is real.
// `validation_failed` mirrors the attempt ledger's vocabulary for a future
// writer that learns the outcome before settling; no current caller emits it.
export function settleSpend(
  path: string,
  input: {
    reservationId: string;
    outcome: "succeeded" | "transport_failed" | "validation_failed";
    actualMicrocents?: number;
  },
): void {
  readBudget(path); // fail closed on a broken record before appending
  if (
    input.outcome !== "transport_failed" &&
    input.actualMicrocents === undefined
  ) {
    // Never substitute zero for an unknown actual: that would overstate the
    // remaining budget, the one direction this record must never err.
    throw new BudgetIntegrityError(
      `Settlement for ${input.reservationId} (${input.outcome}) requires its actual cost`,
    );
  }
  appendDurably(path, {
    kind: "settlement",
    at: new Date().toISOString(),
    reservationId: input.reservationId,
    outcome: input.outcome,
    ...(input.outcome === "transport_failed"
      ? {}
      : { actualMicrocents: input.actualMicrocents! }),
  });
}

// The durable per-brief committed total for one role: settled actuals plus
// reservations whose real cost is unknown (unsettled or transport-failed) at
// their estimates. The per-brief cap reads THIS, not an in-memory counter,
// so a retried brief cannot restart its cap from zero.
export function briefCommittedMicrocents(
  state: BudgetState,
  runId: string,
  briefId: string,
  role: "consultant" | "judge",
): number {
  const reservations = new Map<string, number>();
  for (const entry of state.entries) {
    if (
      entry.kind === "reservation" &&
      entry.runId === runId &&
      entry.briefId === briefId &&
      entry.role === role
    ) {
      reservations.set(entry.id, entry.estimateMicrocents);
    }
  }
  let committed = 0;
  const settled = new Set<string>();
  for (const entry of state.entries) {
    if (entry.kind !== "settlement" || !reservations.has(entry.reservationId)) {
      continue;
    }
    settled.add(entry.reservationId);
    committed +=
      entry.outcome === "transport_failed"
        ? reservations.get(entry.reservationId)!
        : entry.actualMicrocents!;
  }
  for (const [id, estimate] of reservations) {
    if (!settled.has(id)) {
      committed += estimate;
    }
  }
  return committed;
}
