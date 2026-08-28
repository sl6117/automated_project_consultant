import type Database from "better-sqlite3";
import { CORE_CODES } from "../model/rubric";
import { listConcerns } from "./concerns";
import { listContradictions } from "./contradictions";
import { nowIso } from "./projects";
import { getPendingQuestion } from "./questions";
import { LedgerValidationError, listStatements } from "./statements";

// The stop decision is deliberately dumb: five items computed from ledger
// rows, no model judgement anywhere. Fable's readyAdvice is displayable
// advice and satisfies NO item — there is no code path from it to this
// checklist or to the confirm button.

export class FramingNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FramingNotReadyError";
  }
}

export type StopChecklistItem = {
  key:
    | "core-coverage"
    | "no-open-tensions"
    | "fact-or-decision"
    | "no-pending-question"
    | "no-unreviewed-proposals";
  label: string;
  pass: boolean;
  evidence: string;
};

export type StopChecklist = {
  items: StopChecklistItem[];
  passes: boolean;
};

function requireSession(db: Database.Database, sessionId: string): void {
  const row = db
    .prepare("SELECT id FROM discovery_sessions WHERE id = ?")
    .get(sessionId);
  if (!row) {
    throw new LedgerValidationError(`Session ${sessionId} not found`);
  }
}

export function evaluateStopChecklist(
  db: Database.Database,
  sessionId: string,
): StopChecklist {
  requireSession(db, sessionId);

  const approvedCodes = new Set(
    listConcerns(db, sessionId, "approved").map((row) => row.code),
  );
  const missingCore = CORE_CODES.filter((code) => !approvedCodes.has(code));

  const openTensions = listContradictions(db, sessionId, "open").length;

  const hasFactOrDecision = listStatements(db, sessionId, "approved").some(
    (row) => row.kind === "fact" || row.kind === "decision",
  );

  const pendingQuestion = getPendingQuestion(db, sessionId) !== null;

  const unreviewed =
    listStatements(db, sessionId, "proposed").length +
    listConcerns(db, sessionId, "proposed").length;

  const items: StopChecklistItem[] = [
    {
      key: "core-coverage",
      label: "Core concerns covered",
      pass: missingCore.length === 0,
      evidence:
        missingCore.length === 0
          ? "problem, user, workflow, and success all have approved coverage"
          : `missing approved coverage: ${missingCore.join(", ")}`,
    },
    {
      key: "no-open-tensions",
      label: "No open tensions",
      pass: openTensions === 0,
      evidence:
        openTensions === 0
          ? "no open contradiction remains"
          : `${openTensions} open tension${openTensions === 1 ? "" : "s"} to dismiss or resolve`,
    },
    {
      key: "fact-or-decision",
      label: "An approved fact or decision exists",
      pass: hasFactOrDecision,
      evidence: hasFactOrDecision
        ? "the ledger holds at least one approved fact or decision"
        : "no approved statement of kind fact or decision yet",
    },
    {
      key: "no-pending-question",
      label: "No pending question",
      pass: !pendingQuestion,
      evidence: pendingQuestion
        ? "a question is waiting for an answer"
        : "no question is waiting for an answer",
    },
    {
      key: "no-unreviewed-proposals",
      label: "No unreviewed proposals",
      pass: unreviewed === 0,
      evidence:
        unreviewed === 0
          ? "every proposed statement and concern has been reviewed"
          : `${unreviewed} proposal${unreviewed === 1 ? "" : "s"} await review`,
    },
  ];

  return { items, passes: items.every((item) => item.pass) };
}

export function getFramedAt(
  db: Database.Database,
  sessionId: string,
): string | null {
  const row = db
    .prepare("SELECT framed_at FROM discovery_sessions WHERE id = ?")
    .get(sessionId) as { framed_at: string | null } | undefined;
  if (!row) {
    throw new LedgerValidationError(`Session ${sessionId} not found`);
  }
  return row.framed_at;
}

// Only the user's explicit confirmation writes framed_at, and only while the
// checklist actually passes — readyAdvice has no path here. The timestamp is
// never cleared: if the checklist later fails, the UI shows the framing as
// stale instead. A repeat confirm keeps the original timestamp.
export function confirmFraming(
  db: Database.Database,
  sessionId: string,
): { sessionId: string; framedAt: string } {
  const run = db.transaction(() => {
    const existing = getFramedAt(db, sessionId);
    if (existing !== null) {
      return { sessionId, framedAt: existing };
    }

    const checklist = evaluateStopChecklist(db, sessionId);
    if (!checklist.passes) {
      const failing = checklist.items
        .filter((item) => !item.pass)
        .map((item) => item.evidence)
        .join("; ");
      throw new FramingNotReadyError(
        `The stop checklist does not pass: ${failing}`,
      );
    }

    const framedAt = nowIso();
    db.prepare("UPDATE discovery_sessions SET framed_at = ? WHERE id = ?").run(
      framedAt,
      sessionId,
    );
    return { sessionId, framedAt };
  });
  return run();
}
