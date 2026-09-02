import { describe, expect, test } from "vitest";
import { openTestLedger } from "../helpers/test-db";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import {
  LedgerValidationError,
  approveStatement,
  editStatement,
  listStatements,
  proposeStatement,
  rejectStatement,
} from "../../../src/server/ledger/statements";

function seedSession() {
  const db = openTestLedger();
  const project = createProject(db, "Synthetic inbox");
  const session = createSession(db, project.id);
  return { db, sessionId: session.id };
}

describe("statement ledger", () => {
  test("persists proposals as proposed, not approved facts", () => {
    const { db, sessionId } = seedSession();

    const proposed = proposeStatement(db, {
      sessionId,
      kind: "fact",
      body: "Users triage incoming messages once a day.",
      provenanceSource: "model-inference",
    });

    expect(proposed.status).toBe("proposed");
    expect(listStatements(db, sessionId, "approved")).toHaveLength(0);
    expect(listStatements(db, sessionId, "proposed")).toHaveLength(1);
  });

  test("approveStatement is required before a statement is approved", () => {
    const { db, sessionId } = seedSession();
    const proposed = proposeStatement(db, {
      sessionId,
      kind: "hypothesis",
      body: "Email volume is the main pain.",
      provenanceSource: "model-inference",
    });

    const approved = approveStatement(db, proposed.id);

    expect(approved.status).toBe("approved");
    expect(listStatements(db, sessionId, "approved")).toEqual([approved]);
  });

  test("rejectStatement keeps the row and its provenance", () => {
    const { db, sessionId } = seedSession();
    const proposed = proposeStatement(db, {
      sessionId,
      kind: "fact",
      body: "This proposal is wrong.",
      provenanceSource: "model-inference",
    });

    const rejected = rejectStatement(db, proposed.id);

    expect(rejected.status).toBe("rejected");
    expect(rejected.provenance_source).toBe("model-inference");
    expect(listStatements(db, sessionId, "rejected")).toEqual([rejected]);
    expect(listStatements(db, sessionId, "approved")).toHaveLength(0);
    expect(() => approveStatement(db, proposed.id)).toThrow(
      LedgerValidationError,
    );
  });

  test("editStatement rejects the original and links an approved user revision", () => {
    const { db, sessionId } = seedSession();
    const proposed = proposeStatement(db, {
      sessionId,
      kind: "fact",
      body: "Users triage twice a day.",
      provenanceSource: "model-inference",
    });

    const { original, revised } = editStatement(db, {
      statementId: proposed.id,
      body: "Users triage once a day.",
    });

    expect(original.id).toBe(proposed.id);
    expect(original.status).toBe("rejected");
    expect(original.provenance_source).toBe("model-inference");
    expect(revised.status).toBe("approved");
    expect(revised.kind).toBe("fact");
    expect(revised.body).toBe("Users triage once a day.");
    expect(revised.provenance_source).toBe("user");
    expect(revised.revises_statement_id).toBe(proposed.id);
    expect(listStatements(db, sessionId, "approved")).toEqual([revised]);
  });

  test("editStatement refuses a statement that is not proposed", () => {
    const { db, sessionId } = seedSession();
    const proposed = proposeStatement(db, {
      sessionId,
      kind: "decision",
      body: "Already settled.",
      provenanceSource: "user",
    });
    approveStatement(db, proposed.id);

    expect(() =>
      editStatement(db, { statementId: proposed.id, body: "Rewritten" }),
    ).toThrow(LedgerValidationError);
    expect(listStatements(db, sessionId)).toHaveLength(1);
  });

  test("rejects invalid kind before writing", () => {
    const { db, sessionId } = seedSession();
    const before = listStatements(db, sessionId);

    expect(() =>
      proposeStatement(db, {
        sessionId,
        kind: "requirement" as never,
        body: "Should not persist",
        provenanceSource: "user",
      }),
    ).toThrow(LedgerValidationError);

    expect(listStatements(db, sessionId)).toEqual(before);
  });

  test("rejects empty body", () => {
    const { db, sessionId } = seedSession();

    expect(() =>
      proposeStatement(db, {
        sessionId,
        kind: "fact",
        body: "",
        provenanceSource: "user",
      }),
    ).toThrow(LedgerValidationError);
  });
});
