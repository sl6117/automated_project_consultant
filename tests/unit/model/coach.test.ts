import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import { listCoachNotes } from "../../../src/server/ledger/coach-notes";
import { approveConcern } from "../../../src/server/ledger/concerns";
import { CostCapError } from "../../../src/server/ledger/cost";
import { getPendingQuestion } from "../../../src/server/ledger/questions";
import {
  LedgerValidationError,
  approveStatement,
} from "../../../src/server/ledger/statements";
import type { ModelClient } from "../../../src/server/model/client";
import {
  CoachValidationError,
  requestCoaching,
} from "../../../src/server/model/coach";
import { extractAndStartSession } from "../../../src/server/model/extract";
import { createRecordedModelClient } from "../../../src/server/model/recorded-client";
import { createStubModelClient } from "../../../src/server/model/stub-client";

const fixtureDir = join(process.cwd(), "tests/fixtures/phase-1");

function coachFixturePayload(): Record<string, unknown> {
  const envelope = JSON.parse(
    readFileSync(join(fixtureDir, "fable-coach.json"), "utf8"),
  ) as { payload: Record<string, unknown> };
  return envelope.payload;
}

function coachEnvelope(payload: unknown): unknown {
  return { task: "coach", payload };
}

// A coach-only fake: crafted payloads exercise the validation boundary
// without touching fixtures on disk; the capture exposes what context the
// boundary sent.
function coachClient(
  payload: unknown,
  capture?: { input?: unknown },
): ModelClient {
  return {
    executionProvenance: "recorded",
    async extractFromIdea() {
      throw new Error("not used");
    },
    async nextQuestion() {
      throw new Error("not used");
    },
    async coachRecommendation(input) {
      if (capture) {
        capture.input = input;
      }
      return { payload, usage: null };
    },
  };
}

async function startActiveSession(db: ReturnType<typeof openMemoryLedger>) {
  const result = await extractAndStartSession(db, {
    projectName: "Life Admin Inbox",
    idea: "A box for household tasks",
    client: createRecordedModelClient(),
  });
  const question = getPendingQuestion(db, result.sessionId);
  if (!question) {
    throw new Error("Expected a pending question after session start");
  }
  return { sessionId: result.sessionId, question };
}

function initializationStatus(
  db: ReturnType<typeof openMemoryLedger>,
  sessionId: string,
): string {
  const row = db
    .prepare(
      "SELECT initialization_status FROM discovery_sessions WHERE id = ?",
    )
    .get(sessionId) as { initialization_status: string };
  return row.initialization_status;
}

describe("requestCoaching", () => {
  test("persists the recorded coach note tied to the question and a fable receipt", async () => {
    const db = openMemoryLedger();
    const { sessionId, question } = await startActiveSession(db);

    const { note, sessionId: derived } = await requestCoaching(db, {
      questionId: question.id,
      client: createRecordedModelClient(),
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
        "SELECT model_alias, status, execution_provenance, recorded FROM model_calls WHERE id = ?",
      )
      .get(note.model_call_id) as {
      model_alias: string;
      status: string;
      execution_provenance: string;
      recorded: number;
    };
    expect(call.model_alias).toBe("fable");
    expect(call.status).toBe("succeeded");
    expect(call.execution_provenance).toBe("recorded");
    expect(call.recorded).toBe(1);
  });

  test("an invalid payload keeps a validation_failed receipt and the session active", async () => {
    const db = openMemoryLedger();
    const { sessionId, question } = await startActiveSession(db);

    await expect(
      requestCoaching(db, {
        questionId: question.id,
        client: coachClient(
          coachEnvelope({ ...coachFixturePayload(), confidence: "very high" }),
        ),
      }),
    ).rejects.toThrow(CoachValidationError);

    expect(listCoachNotes(db, sessionId)).toHaveLength(0);
    // The coaching failure never marks an active consultation failed.
    expect(initializationStatus(db, sessionId)).toBe("active");

    const failed = db
      .prepare(
        "SELECT COUNT(*) AS n FROM model_calls WHERE session_id = ? AND status = 'validation_failed'",
      )
      .get(sessionId) as { n: number };
    expect(failed.n).toBe(1);
  });

  test("rejects a valid payload under the wrong task tag", async () => {
    const db = openMemoryLedger();
    const { sessionId, question } = await startActiveSession(db);

    // A schema-valid next_question envelope must not become a coach note.
    await expect(
      requestCoaching(db, {
        questionId: question.id,
        client: coachClient({
          task: "next_question",
          payload: { body: "A valid question?", whySelected: "valid reason" },
        }),
      }),
    ).rejects.toThrow(CoachValidationError);
    expect(listCoachNotes(db, sessionId)).toHaveLength(0);
  });

  test("rejects a payload carrying fields outside the coach contract", async () => {
    const db = openMemoryLedger();
    const { sessionId, question } = await startActiveSession(db);

    await expect(
      requestCoaching(db, {
        questionId: question.id,
        client: coachClient(
          coachEnvelope({
            ...coachFixturePayload(),
            internalReasoning: "must never be persisted",
          }),
        ),
      }),
    ).rejects.toThrow(CoachValidationError);
    expect(listCoachNotes(db, sessionId)).toHaveLength(0);
  });

  test("rejects a whitespace-only falsifier", async () => {
    const db = openMemoryLedger();
    const { sessionId, question } = await startActiveSession(db);

    await expect(
      requestCoaching(db, {
        questionId: question.id,
        client: coachClient(
          coachEnvelope({ ...coachFixturePayload(), evidenceWouldChange: "   " }),
        ),
      }),
    ).rejects.toThrow(CoachValidationError);
    expect(listCoachNotes(db, sessionId)).toHaveLength(0);
  });

  test("stub coaching is synthetic and references the pending question", async () => {
    const db = openMemoryLedger();
    const client = createStubModelClient();
    const result = await extractAndStartSession(db, {
      projectName: "Ramen ops",
      idea: "ramen restaurant inventory and budget manager",
      client,
    });
    const question = getPendingQuestion(db, result.sessionId);
    if (!question) {
      throw new Error("Expected a pending question after session start");
    }

    const { note } = await requestCoaching(db, {
      questionId: question.id,
      client,
    });

    expect(note.recommendation).toContain("Ramen ops");
    expect(note.why_now).toContain(question.body);

    const call = db
      .prepare("SELECT execution_provenance FROM model_calls WHERE id = ?")
      .get(note.model_call_id) as { execution_provenance: string };
    expect(call.execution_provenance).toBe("synthetic");
  });

  test("coaching sends approved statements and concerns as context", async () => {
    const db = openMemoryLedger();
    const { sessionId, question } = await startActiveSession(db);
    const proposed = db
      .prepare(
        "SELECT id FROM statements WHERE session_id = ? AND status = 'proposed' ORDER BY created_at LIMIT 1",
      )
      .get(sessionId) as { id: string };
    approveStatement(db, proposed.id);
    const proposedConcern = db
      .prepare(
        "SELECT id FROM concerns WHERE session_id = ? AND status = 'proposed' ORDER BY created_at LIMIT 1",
      )
      .get(sessionId) as { id: string };
    approveConcern(db, proposedConcern.id);

    const capture: { input?: unknown } = {};
    await requestCoaching(db, {
      questionId: question.id,
      client: coachClient(coachEnvelope(coachFixturePayload()), capture),
    });

    const input = capture.input as {
      questionBody: string;
      approvedStatements: string[];
      approvedConcerns: string[];
    };
    expect(input.questionBody).toContain("Who captures");
    expect(input.approvedStatements).toStrictEqual([
      "The user wants a household life-admin inbox for incoming tasks.",
    ]);
    expect(input.approvedConcerns).toStrictEqual([
      "user: A single household operator capturing tasks from email and chat.",
    ]);
  });

  test("the over-cap confirmation threads through coaching to the attempt row", async () => {
    const db = openMemoryLedger();
    const { sessionId, question } = await startActiveSession(db);
    // Shrink the cap below any conservative estimate.
    db.prepare(
      "UPDATE discovery_sessions SET cap_microcents = 0 WHERE id = ?",
    ).run(sessionId);

    await expect(
      requestCoaching(db, {
        questionId: question.id,
        client: createRecordedModelClient(),
      }),
    ).rejects.toThrow(CostCapError);
    expect(listCoachNotes(db, sessionId)).toHaveLength(0);

    const { note } = await requestCoaching(db, {
      questionId: question.id,
      client: createRecordedModelClient(),
      confirmedOverCap: true,
    });
    const call = db
      .prepare(
        "SELECT confirmed_over_cap, status FROM model_calls WHERE id = ?",
      )
      .get(note.model_call_id) as {
      confirmed_over_cap: number;
      status: string;
    };
    expect(call.confirmed_over_cap).toBe(1);
    expect(call.status).toBe("succeeded");
  });

  test("an unknown question id fails before any model bookkeeping", async () => {
    const db = openMemoryLedger();
    const { sessionId } = await startActiveSession(db);
    const before = db
      .prepare("SELECT COUNT(*) AS n FROM model_calls WHERE session_id = ?")
      .get(sessionId) as { n: number };

    // A stale question id must surface as LedgerValidationError so the UI
    // maps it to the safe "reload the page" message instead of crashing.
    await expect(
      requestCoaching(db, {
        questionId: "missing",
        client: createRecordedModelClient(),
      }),
    ).rejects.toThrow(LedgerValidationError);

    const after = db
      .prepare("SELECT COUNT(*) AS n FROM model_calls WHERE session_id = ?")
      .get(sessionId) as { n: number };
    expect(after.n).toBe(before.n);
    expect(listCoachNotes(db, sessionId)).toHaveLength(0);
  });
});
