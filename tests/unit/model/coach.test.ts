import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import { listCoachNotes } from "../../../src/server/ledger/coach-notes";
import { getPendingQuestion } from "../../../src/server/ledger/questions";
import {
  CoachValidationError,
  applyCoachNote,
  requestCoaching,
} from "../../../src/server/model/coach";
import { LedgerValidationError } from "../../../src/server/ledger/statements";
import { extractAndStartSession } from "../../../src/server/model/extract";
import { createRecordedModelClient } from "../../../src/server/model/recorded-client";
import { createStubModelClient } from "../../../src/server/model/stub-client";

const fixtureDir = join(process.cwd(), "tests/fixtures/phase-1");

function startRecordedSession(
  db: ReturnType<typeof openMemoryLedger>,
  coachPath?: string,
) {
  const client = createRecordedModelClient(
    coachPath ? { coachPath } : undefined,
  );
  const { sessionId } = extractAndStartSession(db, {
    projectName: "Life Admin Inbox",
    idea: "A box for household tasks",
    client,
  });
  const question = getPendingQuestion(db, sessionId);
  if (!question) {
    throw new Error("Expected a pending question after session start");
  }
  return { client, sessionId, question };
}

describe("requestCoaching", () => {
  test("persists the recorded coach note tied to the question and a fable call", () => {
    const db = openMemoryLedger();
    const { client, sessionId, question } = startRecordedSession(db);

    const { note, sessionId: derived } = requestCoaching(db, {
      questionId: question.id,
      client,
    });

    expect(derived).toBe(sessionId);
    expect(note.session_id).toBe(sessionId);
    expect(note.question_id).toBe(question.id);
    expect(note.recommendation).toContain("shared capture inbox");
    expect(note.confidence).toBe("medium");
    expect(note.promoted).toBe(0);
    expect(note.provenance_source).toBe("model-inference");

    const call = db
      .prepare(
        "SELECT model_alias, execution_provenance, recorded FROM model_calls WHERE id = ?",
      )
      .get(note.model_call_id) as {
      model_alias: string;
      execution_provenance: string;
      recorded: number;
    };
    expect(call.model_alias).toBe("fable");
    expect(call.execution_provenance).toBe("recorded");
    expect(call.recorded).toBe(1);
  });

  test("rejects an invalid coach payload and persists neither note nor call", () => {
    const db = openMemoryLedger();
    const { client, sessionId, question } = startRecordedSession(
      db,
      join(fixtureDir, "fable-coach-invalid.json"),
    );

    expect(() =>
      requestCoaching(db, { questionId: question.id, client }),
    ).toThrow(CoachValidationError);

    expect(listCoachNotes(db, sessionId)).toHaveLength(0);
    const calls = db
      .prepare("SELECT COUNT(*) AS n FROM model_calls WHERE session_id = ?")
      .get(sessionId) as { n: number };
    expect(calls.n).toBe(2);
  });

  test("stub coaching is synthetic and references the pending question", () => {
    const db = openMemoryLedger();
    const client = createStubModelClient();
    const { sessionId } = extractAndStartSession(db, {
      projectName: "Ramen ops",
      idea: "ramen restaurant inventory and budget manager",
      client,
    });
    const question = getPendingQuestion(db, sessionId);
    if (!question) {
      throw new Error("Expected a pending question after session start");
    }

    const { note } = requestCoaching(db, { questionId: question.id, client });

    expect(note.recommendation).toContain("Ramen ops");
    expect(note.why_now).toContain(question.body);

    const call = db
      .prepare("SELECT execution_provenance FROM model_calls WHERE id = ?")
      .get(note.model_call_id) as { execution_provenance: string };
    expect(call.execution_provenance).toBe("synthetic");
  });

  test("rejects a payload carrying fields outside the coach contract", () => {
    const db = openMemoryLedger();
    const { sessionId } = startRecordedSession(db);
    const payload = {
      ...(JSON.parse(
        readFileSync(join(fixtureDir, "fable-coach.json"), "utf8"),
      ) as Record<string, unknown>),
      internalReasoning: "must never be persisted",
    };

    expect(() =>
      applyCoachNote(db, {
        sessionId,
        payload,
        executionProvenance: "recorded",
      }),
    ).toThrow(CoachValidationError);
    expect(listCoachNotes(db, sessionId)).toHaveLength(0);
  });

  test("rejects a whitespace-only falsifier", () => {
    const db = openMemoryLedger();
    const { sessionId } = startRecordedSession(db);
    const payload = {
      ...(JSON.parse(
        readFileSync(join(fixtureDir, "fable-coach.json"), "utf8"),
      ) as Record<string, unknown>),
      evidenceWouldChange: "   ",
    };

    expect(() =>
      applyCoachNote(db, {
        sessionId,
        payload,
        executionProvenance: "recorded",
      }),
    ).toThrow(CoachValidationError);
    expect(listCoachNotes(db, sessionId)).toHaveLength(0);
  });

  test("an unknown question id fails before any model bookkeeping", () => {
    const db = openMemoryLedger();
    const { client, sessionId } = startRecordedSession(db);

    // A stale question id must surface as LedgerValidationError so the UI
    // maps it to the safe "reload the page" message instead of crashing.
    expect(() =>
      requestCoaching(db, { questionId: "missing", client }),
    ).toThrow(LedgerValidationError);
    expect(listCoachNotes(db, sessionId)).toHaveLength(0);
  });
});
