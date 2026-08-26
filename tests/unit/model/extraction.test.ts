import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import { getPendingQuestion, listQuestions } from "../../../src/server/ledger/questions";
import { listConcerns } from "../../../src/server/ledger/concerns";
import { listStatements } from "../../../src/server/ledger/statements";
import {
  ExtractionValidationError,
  applyExtraction,
  extractAndStartSession,
} from "../../../src/server/model/extract";
import {
  NextQuestionValidationError,
  applyNextQuestion,
} from "../../../src/server/model/next-question";
import { createRecordedModelClient } from "../../../src/server/model/recorded-client";
import { createStubModelClient } from "../../../src/server/model/stub-client";

const fixtureDir = join(process.cwd(), "tests/fixtures/phase-1");

describe("recorded extraction", () => {
  test("parses the Sonnet fixture and writes only proposed rows", () => {
    const db = openMemoryLedger();
    const client = createRecordedModelClient({
      extractionPath: join(fixtureDir, "sonnet-extraction.json"),
    });

    const { sessionId } = extractAndStartSession(db, {
      projectName: "Life Admin Inbox",
      idea: "A box for household tasks",
      client,
    });

    const proposed = listStatements(db, sessionId, "proposed");
    const approved = listStatements(db, sessionId, "approved");
    const concerns = listConcerns(db, sessionId, "proposed");
    const pending = getPendingQuestion(db, sessionId);

    expect(proposed).toHaveLength(2);
    expect(approved).toHaveLength(0);
    expect(concerns).toHaveLength(2);
    expect(proposed[0]?.provenance_source).toBe("model-inference");
    expect(pending?.body).toContain("Who captures incoming household tasks");
    expect(pending?.why_selected.length).toBeGreaterThan(0);
    expect(pending?.provenance_source).toBe("model-inference");

    const calls = db
      .prepare(
        "SELECT execution_provenance, recorded FROM model_calls WHERE session_id = ?",
      )
      .all(sessionId) as { execution_provenance: string; recorded: number }[];
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.execution_provenance === "recorded")).toBe(
      true,
    );
    expect(calls.every((call) => call.recorded === 1)).toBe(true);
  });

  test("rejects invalid extraction JSON and writes no session", () => {
    const db = openMemoryLedger();
    const payload = JSON.parse(
      readFileSync(join(fixtureDir, "sonnet-extraction-invalid.json"), "utf8"),
    ) as unknown;

    expect(() =>
      applyExtraction(db, {
        projectName: "Should not exist",
        payload,
        executionProvenance: "recorded",
      }),
    ).toThrow(ExtractionValidationError);

    const count = db.prepare("SELECT COUNT(*) AS n FROM projects").get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });

  test("an invalid question payload aborts the whole session start", () => {
    const db = openMemoryLedger();
    const client = createRecordedModelClient({
      extractionPath: join(fixtureDir, "sonnet-extraction.json"),
      questionPath: join(fixtureDir, "fable-next-question-invalid.json"),
    });

    expect(() =>
      extractAndStartSession(db, {
        projectName: "Should not exist",
        idea: "A box for household tasks",
        client,
      }),
    ).toThrow(NextQuestionValidationError);

    const projects = db.prepare("SELECT COUNT(*) AS n FROM projects").get() as {
      n: number;
    };
    const statements = db
      .prepare("SELECT COUNT(*) AS n FROM statements")
      .get() as { n: number };
    expect(projects.n).toBe(0);
    expect(statements.n).toBe(0);
  });

  test("stub extraction quotes the submitted title and idea", () => {
    const db = openMemoryLedger();
    const idea = "ramen restaurant inventory and budget manager";
    const { sessionId } = extractAndStartSession(db, {
      projectName: "Ramen ops",
      idea,
      client: createStubModelClient(),
    });

    const proposed = listStatements(db, sessionId, "proposed");
    expect(proposed.some((row) => row.body.includes("Ramen ops"))).toBe(true);
    expect(proposed.some((row) => row.body.includes(idea))).toBe(true);
    expect(getPendingQuestion(db, sessionId)?.body).toContain("Ramen ops");

    const calls = db
      .prepare(
        "SELECT execution_provenance, recorded FROM model_calls WHERE session_id = ?",
      )
      .all(sessionId) as { execution_provenance: string; recorded: number }[];
    expect(calls).toHaveLength(2);
    expect(
      calls.every((call) => call.execution_provenance === "synthetic"),
    ).toBe(true);
    expect(calls.every((call) => call.recorded === 1)).toBe(true);
  });
});

describe("recorded next question", () => {
  test("parses the Fable fixture", () => {
    const db = openMemoryLedger();
    const { sessionId } = applyExtraction(db, {
      projectName: "Life Admin Inbox",
      idea: "A box for household tasks",
      payload: JSON.parse(
        readFileSync(join(fixtureDir, "sonnet-extraction.json"), "utf8"),
      ) as unknown,
      executionProvenance: "recorded",
    });

    const payload = JSON.parse(
      readFileSync(join(fixtureDir, "fable-next-question.json"), "utf8"),
    ) as unknown;
    const { questionId } = applyNextQuestion(db, {
      sessionId,
      payload,
      executionProvenance: "recorded",
    });

    const pending = getPendingQuestion(db, sessionId);
    expect(pending?.id).toBe(questionId);
    expect(pending?.why_selected).toContain("operator or capture surface");

    const call = db
      .prepare(
        "SELECT model_alias, recorded FROM model_calls WHERE session_id = ? AND model_alias = 'fable'",
      )
      .get(sessionId) as { model_alias: string; recorded: number };
    expect(call.model_alias).toBe("fable");
    expect(call.recorded).toBe(1);
  });

  test("rejects invalid Fable JSON and writes no question", () => {
    const db = openMemoryLedger();
    const { sessionId } = applyExtraction(db, {
      projectName: "Life Admin Inbox",
      payload: JSON.parse(
        readFileSync(join(fixtureDir, "sonnet-extraction.json"), "utf8"),
      ) as unknown,
      executionProvenance: "recorded",
    });

    const payload = JSON.parse(
      readFileSync(join(fixtureDir, "fable-next-question-invalid.json"), "utf8"),
    ) as unknown;

    expect(() =>
      applyNextQuestion(db, {
        sessionId,
        payload,
        executionProvenance: "recorded",
      }),
    ).toThrow(NextQuestionValidationError);
    expect(listQuestions(db, sessionId)).toHaveLength(0);
    expect(listStatements(db, sessionId, "proposed")).toHaveLength(2);
  });
});
