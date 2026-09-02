import { describe, expect, test } from "vitest";
import { openTestLedger } from "../helpers/test-db";
import {
  approveConcern,
  proposeConcern,
} from "../../../src/server/ledger/concerns";
import {
  dismissContradiction,
  insertContradictions,
  listContradictions,
} from "../../../src/server/ledger/contradictions";
import {
  FramingNotReadyError,
  confirmFraming,
  evaluateStopChecklist,
  getFramedAt,
} from "../../../src/server/ledger/framing";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import { proposeQuestion } from "../../../src/server/ledger/questions";
import {
  approveStatement,
  proposeStatement,
  retractApprovedStatement,
} from "../../../src/server/ledger/statements";

// Builds the minimal green state: all four core codes covered, one approved
// fact, no tensions, no pending question, no proposals.
function readySession(db: ReturnType<typeof openTestLedger>) {
  const project = createProject(db, "Framing", "an idea");
  const session = createSession(db, project.id, 500);
  for (const code of ["problem", "user", "workflow", "success"] as const) {
    approveConcern(
      db,
      proposeConcern(db, {
        sessionId: session.id,
        code,
        coverage: `Approved coverage for ${code}.`,
        provenanceSource: "user",
      }).id,
    );
  }
  const statement = approveStatement(
    db,
    proposeStatement(db, {
      sessionId: session.id,
      kind: "fact",
      body: "The inbox is the single capture surface.",
      provenanceSource: "user",
    }).id,
  );
  return { sessionId: session.id, statement };
}

function failingKeys(
  db: ReturnType<typeof openTestLedger>,
  sessionId: string,
): string[] {
  return evaluateStopChecklist(db, sessionId)
    .items.filter((item) => !item.pass)
    .map((item) => item.key);
}

describe("evaluateStopChecklist", () => {
  test("all five items pass on the minimal green state", () => {
    const db = openTestLedger();
    const { sessionId } = readySession(db);

    const checklist = evaluateStopChecklist(db, sessionId);
    expect(checklist.passes).toBe(true);
    expect(checklist.items).toHaveLength(5);
    expect(checklist.items.every((item) => item.pass)).toBe(true);
  });

  test("each item fails independently with named evidence", () => {
    const db = openTestLedger();
    const { sessionId, statement } = readySession(db);

    // Item 4: a pending question.
    proposeQuestion(db, {
      sessionId,
      body: "One more question?",
      whySelected: "testing",
      provenanceSource: "user",
    });
    expect(failingKeys(db, sessionId)).toStrictEqual(["no-pending-question"]);
    db.prepare("UPDATE questions SET status = 'answered'").run();

    // Item 5: an unreviewed proposal.
    const proposal = proposeStatement(db, {
      sessionId,
      kind: "hypothesis",
      body: "Awaiting review.",
      provenanceSource: "model-inference",
    });
    expect(failingKeys(db, sessionId)).toStrictEqual([
      "no-unreviewed-proposals",
    ]);
    approveStatement(db, proposal.id);

    // Item 2: an open tension.
    insertContradictions(db, {
      sessionId,
      modelCallId: null,
      contradictions: [
        {
          summary: "A tension.",
          citedStatementIds: [statement.id, proposal.id],
        },
      ],
    });
    expect(failingKeys(db, sessionId)).toStrictEqual(["no-open-tensions"]);
    dismissContradiction(db, listContradictions(db, sessionId, "open")[0]!.id);

    // Item 1: a retracted statement does not reopen coverage, but removing a
    // core concern does — simulate by failing coverage on a fresh session.
    const bare = createSession(db, createProject(db, "Bare", "x").id, 500);
    const bareChecklist = evaluateStopChecklist(db, bare.id);
    const core = bareChecklist.items.find(
      (item) => item.key === "core-coverage",
    )!;
    expect(core.pass).toBe(false);
    expect(core.evidence).toContain("problem, user, workflow, success");
    // Item 3 also fails there: no approved fact or decision.
    expect(
      bareChecklist.items.find((item) => item.key === "fact-or-decision")?.pass,
    ).toBe(false);
  });

  test("dismissing the last open tension unblocks the stop", () => {
    const db = openTestLedger();
    const { sessionId, statement } = readySession(db);
    insertContradictions(db, {
      sessionId,
      modelCallId: null,
      contradictions: [
        {
          summary: "Blocking tension.",
          citedStatementIds: [statement.id, statement.id],
        },
      ],
    });
    expect(evaluateStopChecklist(db, sessionId).passes).toBe(false);

    dismissContradiction(db, listContradictions(db, sessionId, "open")[0]!.id);

    expect(evaluateStopChecklist(db, sessionId).passes).toBe(true);
  });

  test("an unknown session is refused", () => {
    const db = openTestLedger();
    expect(() => evaluateStopChecklist(db, "missing")).toThrow(/not found/);
  });
});

describe("confirmFraming", () => {
  test("refuses while the checklist fails and leaves framed_at null", () => {
    const db = openTestLedger();
    const project = createProject(db, "Not ready", "x");
    const session = createSession(db, project.id, 500);

    expect(() => confirmFraming(db, session.id)).toThrow(FramingNotReadyError);
    expect(getFramedAt(db, session.id)).toBeNull();
  });

  test("writes framed_at once and keeps the original on a repeat confirm", () => {
    const db = openTestLedger();
    const { sessionId } = readySession(db);

    const first = confirmFraming(db, sessionId);
    expect(first.framedAt).not.toBeNull();
    expect(getFramedAt(db, sessionId)).toBe(first.framedAt);

    const second = confirmFraming(db, sessionId);
    expect(second.framedAt).toBe(first.framedAt);
  });

  test("framed_at is never cleared when the checklist later fails", () => {
    const db = openTestLedger();
    const { sessionId, statement } = readySession(db);
    const { framedAt } = confirmFraming(db, sessionId);

    // Retract the only approved fact: item 3 fails again.
    retractApprovedStatement(db, statement.id);
    expect(evaluateStopChecklist(db, sessionId).passes).toBe(false);

    // The stamp survives as history; the UI shows staleness instead.
    expect(getFramedAt(db, sessionId)).toBe(framedAt);
  });
});
