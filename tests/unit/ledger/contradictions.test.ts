import { describe, expect, test } from "vitest";
import { openTestLedger } from "../helpers/test-db";
import {
  citedStatementIdsOf,
  dismissContradiction,
  insertContradictions,
  listContradictions,
  retractCitedStatement,
  reviseCitedStatement,
} from "../../../src/server/ledger/contradictions";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import {
  LedgerValidationError,
  approveStatement,
  listStatements,
  proposeStatement,
} from "../../../src/server/ledger/statements";

function seedSession(db: ReturnType<typeof openTestLedger>) {
  const project = createProject(db, "Tensions", "an idea");
  const session = createSession(db, project.id, 500);
  const first = approveStatement(
    db,
    proposeStatement(db, {
      sessionId: session.id,
      kind: "fact",
      body: "The inbox is the single capture surface.",
      provenanceSource: "user",
    }).id,
  );
  const second = approveStatement(
    db,
    proposeStatement(db, {
      sessionId: session.id,
      kind: "hypothesis",
      body: "Capture reliability is still untested.",
      provenanceSource: "user",
    }).id,
  );
  return { sessionId: session.id, first, second };
}

describe("insertContradictions", () => {
  test("persists payload tensions as open rows with their citations", () => {
    const db = openTestLedger();
    const { sessionId, first, second } = seedSession(db);

    const inserted = insertContradictions(db, {
      sessionId,
      modelCallId: null,
      contradictions: [
        {
          summary: "Reliable capture is both assumed and untested.",
          citedStatementIds: [first.id, second.id],
        },
      ],
    });

    expect(inserted).toBe(1);
    const open = listContradictions(db, sessionId, "open");
    expect(open).toHaveLength(1);
    expect(open[0]?.summary).toContain("assumed and untested");
    expect(open[0]?.model_call_id).toBeNull();
    expect(open[0]?.closed_at).toBeNull();
    expect(citedStatementIdsOf(open[0]!)).toStrictEqual([first.id, second.id]);
  });

  test("an exact duplicate of a still-open row is skipped; a closed one may return", () => {
    const db = openTestLedger();
    const { sessionId, first, second } = seedSession(db);
    const tension = {
      summary: "Reliable capture is both assumed and untested.",
      citedStatementIds: [first.id, second.id],
    };

    insertContradictions(db, {
      sessionId,
      modelCallId: null,
      contradictions: [tension],
    });
    const again = insertContradictions(db, {
      sessionId,
      modelCallId: null,
      contradictions: [tension],
    });
    expect(again).toBe(0);
    expect(listContradictions(db, sessionId)).toHaveLength(1);

    // After the user dismisses it, the model may legitimately re-raise it —
    // dismissed rows stay as provenance and do not swallow new passes.
    dismissContradiction(db, listContradictions(db, sessionId)[0]!.id);
    const reRaised = insertContradictions(db, {
      sessionId,
      modelCallId: null,
      contradictions: [tension],
    });
    expect(reRaised).toBe(1);
    expect(listContradictions(db, sessionId)).toHaveLength(2);
    expect(listContradictions(db, sessionId, "open")).toHaveLength(1);
  });
});

describe("dismissContradiction", () => {
  test("closes an open row as dismissed and refuses a second close", () => {
    const db = openTestLedger();
    const { sessionId, first, second } = seedSession(db);
    insertContradictions(db, {
      sessionId,
      modelCallId: null,
      contradictions: [
        {
          summary: "A false alarm.",
          citedStatementIds: [first.id, second.id],
        },
      ],
    });
    const row = listContradictions(db, sessionId, "open")[0]!;

    const dismissed = dismissContradiction(db, row.id);
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.closed_at).not.toBeNull();
    expect(listContradictions(db, sessionId, "open")).toHaveLength(0);

    expect(() => dismissContradiction(db, row.id)).toThrow(
      LedgerValidationError,
    );
    expect(() => dismissContradiction(db, "missing")).toThrow(/not found/);
  });
});

describe("statement-driven resolution", () => {
  test("retracting a cited approved statement resolves every tension citing it", () => {
    const db = openTestLedger();
    const { sessionId, first, second } = seedSession(db);
    const third = approveStatement(
      db,
      proposeStatement(db, {
        sessionId,
        kind: "decision",
        body: "Triage happens once per day.",
        provenanceSource: "user",
      }).id,
    );
    insertContradictions(db, {
      sessionId,
      modelCallId: null,
      contradictions: [
        {
          summary: "Cites the retracted statement.",
          citedStatementIds: [first.id, second.id],
        },
        {
          summary: "Does not cite it.",
          citedStatementIds: [second.id, third.id],
        },
      ],
    });

    const result = retractCitedStatement(db, first.id);

    expect(result.statement.status).toBe("rejected");
    expect(result.resolvedContradictions).toBe(1);
    const rows = listContradictions(db, sessionId);
    expect(
      rows.find((row) => row.summary.includes("retracted"))?.status,
    ).toBe("resolved");
    expect(
      rows.find((row) => row.summary.includes("Does not"))?.status,
    ).toBe("open");
  });

  test("revising a cited statement supersedes it with a user row and resolves the tension", () => {
    const db = openTestLedger();
    const { sessionId, first, second } = seedSession(db);
    insertContradictions(db, {
      sessionId,
      modelCallId: null,
      contradictions: [
        {
          summary: "The canon must change.",
          citedStatementIds: [first.id, second.id],
        },
      ],
    });

    const result = reviseCitedStatement(db, {
      statementId: second.id,
      body: "Capture reliability will be tested during the first slice.",
    });

    expect(result.original.status).toBe("rejected");
    expect(result.revised.status).toBe("approved");
    expect(result.revised.provenance_source).toBe("user");
    expect(result.revised.revises_statement_id).toBe(second.id);
    expect(result.resolvedContradictions).toBe(1);
    const row = listContradictions(db, sessionId)[0]!;
    expect(row.status).toBe("resolved");
    expect(row.closed_at).not.toBeNull();
    // The cited ids keep pointing at the retracted original as provenance.
    expect(citedStatementIdsOf(row)).toContain(second.id);
  });

  test("the path refuses statements no open tension cites", () => {
    const db = openTestLedger();
    const { sessionId, first, second } = seedSession(db);

    // Approved but uncited: this path is for tension resolution, not general
    // re-litigation of approved statements.
    expect(() => retractCitedStatement(db, first.id)).toThrow(
      /not cited by an open tension/,
    );
    expect(() =>
      reviseCitedStatement(db, { statementId: first.id, body: "New body." }),
    ).toThrow(/not cited by an open tension/);

    // A dismissed tension no longer authorizes the path either.
    insertContradictions(db, {
      sessionId,
      modelCallId: null,
      contradictions: [
        {
          summary: "Dismissed before any edit.",
          citedStatementIds: [first.id, second.id],
        },
      ],
    });
    dismissContradiction(db, listContradictions(db, sessionId, "open")[0]!.id);
    expect(() => retractCitedStatement(db, first.id)).toThrow(
      /not cited by an open tension/,
    );
    expect(listStatements(db, sessionId, "approved")).toHaveLength(2);
  });

  test("a cited statement must still be approved to be retracted", () => {
    const db = openTestLedger();
    const { sessionId, second } = seedSession(db);
    const proposed = proposeStatement(db, {
      sessionId,
      kind: "fact",
      body: "Still awaiting review.",
      provenanceSource: "model-inference",
      modelCallId: undefined,
    });
    // The ledger layer does not validate citations on insert (that is the
    // parse boundary's job), so a citation of a proposed row exercises the
    // status guard behind the citation gate.
    insertContradictions(db, {
      sessionId,
      modelCallId: null,
      contradictions: [
        {
          summary: "Cites an unreviewed statement.",
          citedStatementIds: [proposed.id, second.id],
        },
      ],
    });

    expect(() => retractCitedStatement(db, proposed.id)).toThrow(
      /proposed, not approved/,
    );
    expect(listStatements(db, sessionId, "proposed")).toHaveLength(1);
  });

  test("resolution is scoped to the statement's own session", () => {
    const db = openTestLedger();
    const a = seedSession(db);
    const b = seedSession(db);
    // Simulate a future id-collision scenario: session B's tension cites a
    // statement from session A. Session A's retraction must not close it.
    insertContradictions(db, {
      sessionId: a.sessionId,
      modelCallId: null,
      contradictions: [
        {
          summary: "Session A tension.",
          citedStatementIds: [a.first.id, a.second.id],
        },
      ],
    });
    insertContradictions(db, {
      sessionId: b.sessionId,
      modelCallId: null,
      contradictions: [
        {
          summary: "Session B cites a foreign statement.",
          citedStatementIds: [a.first.id, b.second.id],
        },
      ],
    });

    const result = retractCitedStatement(db, a.first.id);

    expect(result.resolvedContradictions).toBe(1);
    expect(listContradictions(db, a.sessionId, "open")).toHaveLength(0);
    expect(listContradictions(db, b.sessionId, "open")).toHaveLength(1);
  });
});
