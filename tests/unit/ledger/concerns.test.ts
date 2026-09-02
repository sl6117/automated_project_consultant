import { describe, expect, test } from "vitest";
import { openTestLedger } from "../helpers/test-db";
import {
  approveConcern,
  editConcern,
  listConcerns,
  proposeConcern,
  rejectConcern,
} from "../../../src/server/ledger/concerns";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import { LedgerValidationError } from "../../../src/server/ledger/statements";

function seedSession() {
  const db = openTestLedger();
  const project = createProject(db, "Synthetic inbox");
  const session = createSession(db, project.id);
  return { db, sessionId: session.id };
}

describe("concern ledger", () => {
  test("persists proposals as proposed until approved", () => {
    const { db, sessionId } = seedSession();

    const proposed = proposeConcern(db, {
      sessionId,
      code: "user",
      coverage: "A single household operator.",
      provenanceSource: "model-inference",
    });
    expect(proposed.status).toBe("proposed");
    expect(listConcerns(db, sessionId, "approved")).toHaveLength(0);

    const approved = approveConcern(db, proposed.id);
    expect(approved.status).toBe("approved");
    expect(listConcerns(db, sessionId, "approved")).toEqual([approved]);
  });

  test("rejectConcern keeps the row and blocks later approval", () => {
    const { db, sessionId } = seedSession();
    const proposed = proposeConcern(db, {
      sessionId,
      code: "data",
      coverage: "Wrong coverage claim.",
      provenanceSource: "model-inference",
    });

    const rejected = rejectConcern(db, proposed.id);

    expect(rejected.status).toBe("rejected");
    expect(rejected.provenance_source).toBe("model-inference");
    expect(listConcerns(db, sessionId, "rejected")).toEqual([rejected]);
    expect(() => approveConcern(db, proposed.id)).toThrow(
      LedgerValidationError,
    );
  });

  test("editConcern rejects the original and links an approved user revision", () => {
    const { db, sessionId } = seedSession();
    const proposed = proposeConcern(db, {
      sessionId,
      code: "non-goals",
      coverage: "Not a social network.",
      provenanceSource: "model-inference",
    });

    const { original, revised } = editConcern(db, {
      concernId: proposed.id,
      coverage: "Not a shared family social network or chat app.",
    });

    expect(original.id).toBe(proposed.id);
    expect(original.status).toBe("rejected");
    expect(revised.status).toBe("approved");
    expect(revised.code).toBe("non-goals");
    expect(revised.coverage).toBe(
      "Not a shared family social network or chat app.",
    );
    expect(revised.provenance_source).toBe("user");
    expect(revised.revises_concern_id).toBe(proposed.id);
    expect(listConcerns(db, sessionId, "approved")).toEqual([revised]);
  });

  test("wraps a foreign-key failure in LedgerValidationError", () => {
    const { db } = seedSession();

    expect(() =>
      proposeConcern(db, {
        sessionId: "no-such-session",
        code: "problem",
        coverage: "Orphan concern.",
        provenanceSource: "model-inference",
      }),
    ).toThrow(LedgerValidationError);
  });
});
