import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import { approveConcern, listConcerns } from "../../../src/server/ledger/concerns";
import {
  getPendingQuestion,
  resolveQuestion,
} from "../../../src/server/ledger/questions";
import {
  LedgerValidationError,
  approveStatement,
  listStatements,
} from "../../../src/server/ledger/statements";
import { extractAndStartSession } from "../../../src/server/model/extract";
import {
  IncrementalExtractionValidationError,
  proposeFromAnswer,
} from "../../../src/server/model/incremental";
import { askAdaptiveQuestion } from "../../../src/server/model/next-question";
import { createRecordedModelClient } from "../../../src/server/model/recorded-client";

const phase2 = join(process.cwd(), "tests/fixtures/phase-2");

// Start recorded, clear review, ask, and answer — the state every
// incremental call begins from.
async function answeredSession(db: ReturnType<typeof openMemoryLedger>) {
  const { sessionId } = await extractAndStartSession(db, {
    projectName: "Life Admin Inbox",
    idea: "A box for household tasks",
    client: createRecordedModelClient(),
  });
  for (const row of listStatements(db, sessionId, "proposed")) {
    approveStatement(db, row.id);
  }
  for (const row of listConcerns(db, sessionId, "proposed")) {
    approveConcern(db, row.id);
  }
  await askAdaptiveQuestion(db, {
    sessionId,
    client: createRecordedModelClient(),
  });
  const question = getPendingQuestion(db, sessionId);
  if (!question) {
    throw new Error("Expected a pending question");
  }
  resolveQuestion(db, {
    questionId: question.id,
    disposition: "answered",
    body: "I capture tasks in one shared inbox and triage daily.",
  });
  return { sessionId, questionId: question.id };
}

function answersFor(
  db: ReturnType<typeof openMemoryLedger>,
  questionId: string,
): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM answers WHERE question_id = ?")
    .get(questionId) as { n: number };
  return row.n;
}

describe("proposeFromAnswer", () => {
  test("valid output lands as proposed rows only, never approved", async () => {
    const db = openMemoryLedger();
    const { sessionId, questionId } = await answeredSession(db);
    const approvedBefore = listStatements(db, sessionId, "approved").length;

    const result = await proposeFromAnswer(db, {
      questionId,
      client: createRecordedModelClient(),
    });

    expect(result).toStrictEqual({
      proposedStatements: 1,
      proposedConcerns: 3,
    });
    const proposed = listStatements(db, sessionId, "proposed");
    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.body).toContain("one shared inbox");
    expect(proposed[0]?.provenance_source).toBe("model-inference");
    expect(proposed[0]?.model_call_id).not.toBeNull();
    expect(listConcerns(db, sessionId, "proposed")).toHaveLength(3);
    expect(listStatements(db, sessionId, "approved")).toHaveLength(
      approvedBefore,
    );
  });

  test("a valid empty payload persists nothing and is not an error", async () => {
    const db = openMemoryLedger();
    const { sessionId, questionId } = await answeredSession(db);

    const result = await proposeFromAnswer(db, {
      questionId,
      client: createRecordedModelClient({
        incrementalPath: join(phase2, "sonnet-incremental-empty.json"),
      }),
    });

    expect(result).toStrictEqual({
      proposedStatements: 0,
      proposedConcerns: 0,
    });
    expect(listStatements(db, sessionId, "proposed")).toHaveLength(0);
    expect(listConcerns(db, sessionId, "proposed")).toHaveLength(0);
    const receipt = db
      .prepare(
        "SELECT status FROM model_calls WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(sessionId) as { status: string };
    expect(receipt.status).toBe("succeeded");
  });

  test("invalid output leaves the answer stored and adds nothing beyond it", async () => {
    const db = openMemoryLedger();
    const { sessionId, questionId } = await answeredSession(db);

    await expect(
      proposeFromAnswer(db, {
        questionId,
        client: createRecordedModelClient({
          incrementalPath: join(phase2, "sonnet-incremental-invalid.json"),
        }),
      }),
    ).rejects.toThrow(IncrementalExtractionValidationError);

    // The answer and the answered question survive; the receipt records the
    // spend; no content was applied.
    expect(answersFor(db, questionId)).toBe(1);
    expect(listStatements(db, sessionId, "proposed")).toHaveLength(0);
    expect(listConcerns(db, sessionId, "proposed")).toHaveLength(0);
    const receipt = db
      .prepare(
        "SELECT status, model_alias FROM model_calls WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(sessionId) as { status: string; model_alias: string };
    expect(receipt.model_alias).toBe("sonnet");
    expect(receipt.status).toBe("validation_failed");
  });

  test("refuses a question that is still pending", async () => {
    const db = openMemoryLedger();
    const { sessionId } = await extractAndStartSession(db, {
      projectName: "Pending",
      idea: "A box for household tasks",
      client: createRecordedModelClient(),
    });
    for (const row of listStatements(db, sessionId, "proposed")) {
      approveStatement(db, row.id);
    }
    for (const row of listConcerns(db, sessionId, "proposed")) {
      approveConcern(db, row.id);
    }
    await askAdaptiveQuestion(db, {
      sessionId,
      client: createRecordedModelClient(),
    });
    const pending = getPendingQuestion(db, sessionId);

    await expect(
      proposeFromAnswer(db, {
        questionId: pending!.id,
        client: createRecordedModelClient(),
      }),
    ).rejects.toThrow(LedgerValidationError);
  });
});
