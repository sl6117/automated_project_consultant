import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import {
  getPendingQuestion,
  listQuestions,
  proposeQuestion,
  resolveQuestion,
} from "../../../src/server/ledger/questions";
import {
  LedgerValidationError,
  listStatements,
} from "../../../src/server/ledger/statements";

function seedSession() {
  const db = openMemoryLedger();
  const project = createProject(db, "Synthetic inbox");
  const session = createSession(db, project.id);
  return { db, sessionId: session.id };
}

describe("question ledger", () => {
  test("proposes one pending question with model provenance", () => {
    const { db, sessionId } = seedSession();

    const question = proposeQuestion(db, {
      sessionId,
      body: "Who captures incoming tasks today?",
      whySelected: "The operator is unnamed.",
      provenanceSource: "model-inference",
    });

    expect(question.status).toBe("pending");
    expect(question.provenance_source).toBe("model-inference");
    expect(getPendingQuestion(db, sessionId)?.id).toBe(question.id);
  });

  test("refuses a second pending question", () => {
    const { db, sessionId } = seedSession();
    proposeQuestion(db, {
      sessionId,
      body: "First question",
      whySelected: "Need a starting point.",
      provenanceSource: "model-inference",
    });

    expect(() =>
      proposeQuestion(db, {
        sessionId,
        body: "Second question",
        whySelected: "Should not persist.",
        provenanceSource: "model-inference",
      }),
    ).toThrow(LedgerValidationError);

    expect(listQuestions(db, sessionId)).toHaveLength(1);
  });

  test("recording an answer stores user provenance and approves nothing", () => {
    const { db, sessionId } = seedSession();
    const question = proposeQuestion(db, {
      sessionId,
      body: "What is the first working version?",
      whySelected: "Bounds the slice.",
      provenanceSource: "model-inference",
    });

    const resolved = resolveQuestion(db, {
      questionId: question.id,
      disposition: "answered",
      body: "A capture box that lists today's household tasks.",
    });

    expect(resolved.question.status).toBe("answered");
    expect(resolved.answer.disposition).toBe("answered");
    expect(resolved.answer.provenance_source).toBe("user");
    expect(getPendingQuestion(db, sessionId)).toBeNull();
    // Phase 2 promotion rule: no statement is auto-approved — or even
    // proposed — by resolving. Sonnet's incremental pass proposes instead.
    expect(listStatements(db, sessionId)).toHaveLength(0);
  });

  test("mark unknown and deferred store dispositions without statements", () => {
    const first = seedSession();
    const unknownQuestion = proposeQuestion(first.db, {
      sessionId: first.sessionId,
      body: "Who is the operator?",
      whySelected: "User concern is uncovered.",
      provenanceSource: "model-inference",
    });
    const unknown = resolveQuestion(first.db, {
      questionId: unknownQuestion.id,
      disposition: "unknown",
      body: "",
    });
    expect(unknown.answer.disposition).toBe("unknown");
    expect(unknown.answer.body).toContain("Who is the operator?");
    expect(listStatements(first.db, first.sessionId)).toHaveLength(0);

    const second = seedSession();
    const deferredQuestion = proposeQuestion(second.db, {
      sessionId: second.sessionId,
      body: "Where do tasks pile up?",
      whySelected: "Capture surface is unnamed.",
      provenanceSource: "model-inference",
    });
    const deferred = resolveQuestion(second.db, {
      questionId: deferredQuestion.id,
      disposition: "deferred",
      body: "Decide after watching a week of mail.",
    });
    expect(deferred.answer.disposition).toBe("deferred");
    expect(deferred.answer.body).toBe("Decide after watching a week of mail.");
    expect(listStatements(second.db, second.sessionId)).toHaveLength(0);
  });

  test("rejects an empty answered body and leaves the question pending", () => {
    const { db, sessionId } = seedSession();
    const question = proposeQuestion(db, {
      sessionId,
      body: "What is in scope?",
      whySelected: "Need a boundary.",
      provenanceSource: "model-inference",
    });

    expect(() =>
      resolveQuestion(db, {
        questionId: question.id,
        disposition: "answered",
        body: "   ",
      }),
    ).toThrow(LedgerValidationError);

    expect(getPendingQuestion(db, sessionId)?.id).toBe(question.id);
    expect(listStatements(db, sessionId, "approved")).toHaveLength(0);
  });

  test("cannot resolve an already answered question", () => {
    const { db, sessionId } = seedSession();
    const question = proposeQuestion(db, {
      sessionId,
      body: "Need a name",
      whySelected: "Identity first.",
      provenanceSource: "user",
    });

    resolveQuestion(db, {
      questionId: question.id,
      disposition: "answered",
      body: "Pat",
    });

    expect(() =>
      resolveQuestion(db, {
        questionId: question.id,
        disposition: "answered",
        body: "Again",
      }),
    ).toThrow(LedgerValidationError);
  });
});
