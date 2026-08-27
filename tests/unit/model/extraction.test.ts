import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import { listConcerns } from "../../../src/server/ledger/concerns";
import { sessionSpend } from "../../../src/server/ledger/model-attempts";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import {
  getPendingQuestion,
  listQuestions,
  proposeQuestion,
} from "../../../src/server/ledger/questions";
import { listStatements } from "../../../src/server/ledger/statements";
import {
  extractAndStartSession,
  retryStartSession,
} from "../../../src/server/model/extract";
import { createRecordedModelClient } from "../../../src/server/model/recorded-client";
import { createStubModelClient } from "../../../src/server/model/stub-client";

const fixtureDir = join(process.cwd(), "tests/fixtures/phase-1");

type AttemptSummary = {
  model_alias: string;
  status: string;
  execution_provenance: string;
  recorded: number;
  api_model_id: string | null;
  price_effective_date: string | null;
  actual_cost_microcents: number | null;
};

function attempts(
  db: ReturnType<typeof openMemoryLedger>,
  sessionId: string,
): AttemptSummary[] {
  return db
    .prepare(
      `SELECT model_alias, status, execution_provenance, recorded,
              api_model_id, price_effective_date, actual_cost_microcents
       FROM model_calls WHERE session_id = ? ORDER BY created_at, rowid`,
    )
    .all(sessionId) as AttemptSummary[];
}

function sessionStatus(
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

describe("extractAndStartSession", () => {
  test("recorded fixtures activate the session with proposed content and receipts", async () => {
    const db = openMemoryLedger();
    const result = await extractAndStartSession(db, {
      projectName: "Life Admin Inbox",
      idea: "A box for household tasks",
      client: createRecordedModelClient(),
    });

    expect(result.initializationStatus).toBe("active");
    expect(result.failure).toBeNull();
    expect(sessionStatus(db, result.sessionId)).toBe("active");

    const proposed = listStatements(db, result.sessionId, "proposed");
    expect(proposed).toHaveLength(2);
    expect(listStatements(db, result.sessionId, "approved")).toHaveLength(0);
    expect(listConcerns(db, result.sessionId, "proposed")).toHaveLength(2);
    expect(proposed[0]?.provenance_source).toBe("model-inference");

    const pending = getPendingQuestion(db, result.sessionId);
    expect(pending?.body).toContain("Who captures incoming household tasks");
    expect(pending?.provenance_source).toBe("model-inference");

    const calls = attempts(db, result.sessionId);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.model_alias)).toStrictEqual([
      "sonnet",
      "fable",
    ]);
    expect(calls.every((call) => call.status === "succeeded")).toBe(true);
    expect(calls.every((call) => call.execution_provenance === "recorded")).toBe(
      true,
    );
    expect(calls.every((call) => call.recorded === 1)).toBe(true);
    expect(calls[0]?.api_model_id).toBe("claude-sonnet-4-6");
    expect(calls[1]?.api_model_id).toBe("claude-fable-5");
    expect(calls.every((call) => call.price_effective_date !== null)).toBe(
      true,
    );
  });

  test("an invalid question payload fails the start but keeps session and receipts", async () => {
    const db = openMemoryLedger();
    const result = await extractAndStartSession(db, {
      projectName: "Failed start",
      idea: "A box for household tasks",
      client: createRecordedModelClient({
        questionPath: join(fixtureDir, "fable-next-question-invalid.json"),
      }),
    });

    expect(result.initializationStatus).toBe("failed");
    expect(result.failure).toBe("question-validation");
    expect(sessionStatus(db, result.sessionId)).toBe("failed");

    // Receipts survive; content is all-or-nothing.
    const calls = attempts(db, result.sessionId);
    expect(calls.map((call) => call.status)).toStrictEqual([
      "succeeded",
      "validation_failed",
    ]);
    expect(listStatements(db, result.sessionId)).toHaveLength(0);
    expect(listConcerns(db, result.sessionId, "proposed")).toHaveLength(0);
    expect(listQuestions(db, result.sessionId)).toHaveLength(0);
  });

  test("an invalid extraction payload records one failed receipt and no content", async () => {
    const db = openMemoryLedger();
    const result = await extractAndStartSession(db, {
      projectName: "Failed extraction",
      idea: "A box for household tasks",
      client: createRecordedModelClient({
        extractionPath: join(fixtureDir, "sonnet-extraction-invalid.json"),
      }),
    });

    expect(result.initializationStatus).toBe("failed");
    expect(result.failure).toBe("extraction-validation");

    const calls = attempts(db, result.sessionId);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status).toBe("validation_failed");
    expect(listStatements(db, result.sessionId)).toHaveLength(0);
  });

  test("retry reuses the failed session and its cap instead of creating a new one", async () => {
    const db = openMemoryLedger();
    const failed = await extractAndStartSession(db, {
      projectName: "Retry flow",
      idea: "A box for household tasks",
      client: createRecordedModelClient({
        questionPath: join(fixtureDir, "fable-next-question-invalid.json"),
      }),
    });
    expect(failed.initializationStatus).toBe("failed");

    const retried = await retryStartSession(db, {
      sessionId: failed.sessionId,
      client: createRecordedModelClient(),
    });

    expect(retried.sessionId).toBe(failed.sessionId);
    expect(retried.initializationStatus).toBe("active");
    expect(sessionStatus(db, failed.sessionId)).toBe("active");

    const sessions = db
      .prepare("SELECT COUNT(*) AS n FROM discovery_sessions")
      .get() as { n: number };
    expect(sessions.n).toBe(1);

    // All four attempts share the one session's cap accounting.
    expect(attempts(db, failed.sessionId).map((call) => call.status)).toStrictEqual(
      ["succeeded", "validation_failed", "succeeded", "succeeded"],
    );
    expect(listStatements(db, failed.sessionId, "proposed")).toHaveLength(2);
    expect(getPendingQuestion(db, failed.sessionId)?.body).toContain(
      "Who captures",
    );
  });

  test("a valid coach envelope under the next-question task persists nothing", async () => {
    const db = openMemoryLedger();
    // The coach fixture is a schema-valid Fable envelope with the wrong task
    // tag for the next-question boundary.
    const result = await extractAndStartSession(db, {
      projectName: "Wrong task",
      idea: "A box for household tasks",
      client: createRecordedModelClient({
        questionPath: join(fixtureDir, "fable-coach.json"),
      }),
    });

    expect(result.initializationStatus).toBe("failed");
    expect(result.failure).toBe("question-validation");
    expect(attempts(db, result.sessionId).map((call) => call.status)).toStrictEqual(
      ["succeeded", "validation_failed"],
    );
    expect(listStatements(db, result.sessionId)).toHaveLength(0);
    expect(listQuestions(db, result.sessionId)).toHaveLength(0);
  });

  test("a transport failure settles the receipt and fails the start", async () => {
    const db = openMemoryLedger();
    const broken = createRecordedModelClient();
    const client = {
      ...broken,
      async nextQuestion(): Promise<never> {
        throw new Error("connection reset");
      },
    };

    const result = await extractAndStartSession(db, {
      projectName: "Transport",
      idea: "A box for household tasks",
      client,
    });

    expect(result.initializationStatus).toBe("failed");
    expect(result.failure).toBe("transport");
    expect(attempts(db, result.sessionId).map((call) => call.status)).toStrictEqual(
      ["succeeded", "transport_failed"],
    );
    // Unknown transport spend has no actual; its estimate stays reserved.
    const failedCall = db
      .prepare(
        "SELECT estimated_cost_microcents, actual_cost_microcents FROM model_calls WHERE session_id = ? AND status = 'transport_failed'",
      )
      .get(result.sessionId) as {
      estimated_cost_microcents: number;
      actual_cost_microcents: number | null;
    };
    expect(failedCall.actual_cost_microcents).toBeNull();
    const spend = sessionSpend(db, result.sessionId);
    expect(spend.reservedEstimateMicrocents).toBe(
      failedCall.estimated_cost_microcents,
    );
    expect(spend.reservedEstimateMicrocents).toBeGreaterThan(0);
    expect(listStatements(db, result.sessionId)).toHaveLength(0);
    expect(listQuestions(db, result.sessionId)).toHaveLength(0);
  });

  test("the over-cap confirmation threads from retry through to the attempt rows", async () => {
    const db = openMemoryLedger();
    // A 1-cent cap that every conservative estimate exceeds.
    const project = createProject(db, "Over cap", "A box for household tasks");
    const session = createSession(db, project.id, 1);

    const refused = await retryStartSession(db, {
      sessionId: session.id,
      client: createRecordedModelClient(),
    });
    expect(refused.initializationStatus).toBe("failed");
    expect(refused.failure).toBe("cost-cap");
    // Refusal happens before any spend: no receipt rows exist.
    expect(attempts(db, session.id)).toHaveLength(0);
    expect(listStatements(db, session.id)).toHaveLength(0);

    const confirmed = await retryStartSession(db, {
      sessionId: session.id,
      client: createRecordedModelClient(),
      confirmedOverCap: true,
    });
    expect(confirmed.initializationStatus).toBe("active");
    const calls = db
      .prepare(
        "SELECT confirmed_over_cap, status FROM model_calls WHERE session_id = ?",
      )
      .all(session.id) as { confirmed_over_cap: number; status: string }[];
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.confirmed_over_cap === 1)).toBe(true);
    expect(calls.every((call) => call.status === "succeeded")).toBe(true);
  });

  test("a ledger refusal during the content commit fails the start atomically", async () => {
    const db = openMemoryLedger();
    const project = createProject(db, "Ledger clash", "idea");
    const session = createSession(db, project.id);
    // A pre-existing pending question makes the commit's question insert a
    // Zod-valid but ledger-invalid write.
    proposeQuestion(db, {
      sessionId: session.id,
      body: "Existing pending question?",
      whySelected: "seeded",
      provenanceSource: "user",
    });

    const result = await retryStartSession(db, {
      sessionId: session.id,
      client: createRecordedModelClient(),
    });

    expect(result.initializationStatus).toBe("failed");
    expect(result.failure).toBe("content-ledger");
    expect(sessionStatus(db, session.id)).toBe("failed");
    // Both paid receipts stand; the whole content transaction rolled back.
    expect(attempts(db, session.id).map((call) => call.status)).toStrictEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(listStatements(db, session.id)).toHaveLength(0);
    expect(listQuestions(db, session.id)).toHaveLength(1);
  });

  test("retrying an active session is refused", async () => {
    const db = openMemoryLedger();
    const result = await extractAndStartSession(db, {
      projectName: "Active",
      idea: "A box for household tasks",
      client: createRecordedModelClient(),
    });

    await expect(
      retryStartSession(db, {
        sessionId: result.sessionId,
        client: createRecordedModelClient(),
      }),
    ).rejects.toThrow(/already active/);
  });

  test("stub extraction quotes the submitted title and idea", async () => {
    const db = openMemoryLedger();
    const idea = "ramen restaurant inventory and budget manager";
    const result = await extractAndStartSession(db, {
      projectName: "Ramen ops",
      idea,
      client: createStubModelClient(),
    });

    const proposed = listStatements(db, result.sessionId, "proposed");
    expect(proposed.some((row) => row.body.includes("Ramen ops"))).toBe(true);
    expect(proposed.some((row) => row.body.includes(idea))).toBe(true);
    expect(getPendingQuestion(db, result.sessionId)?.body).toContain(
      "Ramen ops",
    );

    const calls = attempts(db, result.sessionId);
    expect(
      calls.every((call) => call.execution_provenance === "synthetic"),
    ).toBe(true);
    expect(calls.every((call) => call.recorded === 1)).toBe(true);
    expect(calls.every((call) => call.actual_cost_microcents === 0)).toBe(true);
  });
});
