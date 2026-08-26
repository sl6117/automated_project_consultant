import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import {
  getCoachNote,
  listCoachNotes,
  promoteCoachNote,
  proposeCoachNote,
} from "../../../src/server/ledger/coach-notes";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import {
  LedgerValidationError,
  listStatements,
} from "../../../src/server/ledger/statements";
import type { ProposeCoachNoteInput } from "../../../src/server/ledger/schemas";

function seedSession() {
  const db = openMemoryLedger();
  const project = createProject(db, "Coach check");
  const session = createSession(db, project.id);
  return { db, sessionId: session.id };
}

function noteInput(sessionId: string): ProposeCoachNoteInput {
  return {
    sessionId,
    recommendation: "Start with a single shared capture inbox.",
    whyNow: "The pending question decides who captures tasks.",
    technique: "Manual-first capture audit for one week.",
    tradeoffs: "A single inbox is a bottleneck when its operator is away.",
    gotcha: "Automating capture before naming an operator recreates the pile-up.",
    confidence: "medium",
    evidenceWouldChange: "An audit showing one dominant arrival channel.",
    provenanceSource: "model-inference",
  };
}

describe("proposeCoachNote", () => {
  test("persists the structured note with model provenance", () => {
    const { db, sessionId } = seedSession();

    const note = proposeCoachNote(db, noteInput(sessionId));

    expect(note.recommendation).toContain("capture inbox");
    expect(note.confidence).toBe("medium");
    expect(note.evidence_would_change).toContain("audit");
    expect(note.promoted).toBe(0);
    expect(note.provenance_source).toBe("model-inference");
    expect(listCoachNotes(db, sessionId)).toHaveLength(1);
  });

  test("rejects a confidence outside the enum", () => {
    const { db, sessionId } = seedSession();

    expect(() =>
      proposeCoachNote(db, {
        ...noteInput(sessionId),
        confidence: "very high" as never,
      }),
    ).toThrow(LedgerValidationError);
    expect(listCoachNotes(db, sessionId)).toHaveLength(0);
  });

  test("trims required strings before storing them", () => {
    const { db, sessionId } = seedSession();

    const note = proposeCoachNote(db, {
      ...noteInput(sessionId),
      recommendation: "  Start with a single shared capture inbox.  ",
      evidenceWouldChange: " An audit showing one dominant arrival channel. ",
    });

    expect(note.recommendation).toBe(
      "Start with a single shared capture inbox.",
    );
    expect(note.evidence_would_change).toBe(
      "An audit showing one dominant arrival channel.",
    );
  });

  test("rejects a whitespace-only required field", () => {
    const { db, sessionId } = seedSession();

    expect(() =>
      proposeCoachNote(db, {
        ...noteInput(sessionId),
        gotcha: "   ",
      }),
    ).toThrow(LedgerValidationError);
    expect(listCoachNotes(db, sessionId)).toHaveLength(0);
  });

  test("rejects a note missing its falsifier", () => {
    const { db, sessionId } = seedSession();

    expect(() =>
      proposeCoachNote(db, {
        ...noteInput(sessionId),
        evidenceWouldChange: "",
      }),
    ).toThrow(LedgerValidationError);
    expect(listCoachNotes(db, sessionId)).toHaveLength(0);
  });
});

describe("promoteCoachNote", () => {
  test("inserts an approved user-provenance decision linked to the note", () => {
    const { db, sessionId } = seedSession();
    const note = proposeCoachNote(db, noteInput(sessionId));

    const { note: promoted, statement } = promoteCoachNote(db, note.id);

    expect(promoted.promoted).toBe(1);
    expect(statement.kind).toBe("decision");
    expect(statement.status).toBe("approved");
    expect(statement.body).toBe(note.recommendation);
    expect(statement.provenance_source).toBe("user");
    expect(statement.promoted_from_coach_note_id).toBe(note.id);
    expect(listStatements(db, sessionId, "approved")).toHaveLength(1);
  });

  test("refuses to promote the same note twice", () => {
    const { db, sessionId } = seedSession();
    const note = proposeCoachNote(db, noteInput(sessionId));
    promoteCoachNote(db, note.id);

    expect(() => promoteCoachNote(db, note.id)).toThrow(LedgerValidationError);
    expect(listStatements(db, sessionId, "approved")).toHaveLength(1);
    expect(getCoachNote(db, note.id).promoted).toBe(1);
  });

  test("an unknown note id changes nothing", () => {
    const { db, sessionId } = seedSession();

    expect(() => promoteCoachNote(db, "missing")).toThrow(
      LedgerValidationError,
    );
    expect(listStatements(db, sessionId, "approved")).toHaveLength(0);
  });
});
