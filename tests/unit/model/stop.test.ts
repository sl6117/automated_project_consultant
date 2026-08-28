import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import {
  approveConcern,
  listConcerns,
  proposeConcern,
} from "../../../src/server/ledger/concerns";
import { listContradictions } from "../../../src/server/ledger/contradictions";
import {
  confirmFraming,
  getFramedAt,
} from "../../../src/server/ledger/framing";
import { listQuestions, resolveQuestion } from "../../../src/server/ledger/questions";
import {
  approveStatement,
  listStatements,
} from "../../../src/server/ledger/statements";
import { extractAndStartSession } from "../../../src/server/model/extract";
import { askAdaptiveQuestion } from "../../../src/server/model/next-question";
import { createRecordedModelClient } from "../../../src/server/model/recorded-client";

const phase2 = join(process.cwd(), "tests/fixtures/phase-2");

// Brief D setup: recorded start, cleared review, then user-approved coverage
// for the core codes the extraction fixture leaves open. The extraction's
// approved fact satisfies checklist item 3.
async function coveredSession(
  db: ReturnType<typeof openMemoryLedger>,
  options: { skipSuccess?: boolean } = {},
) {
  const { sessionId } = await extractAndStartSession(db, {
    projectName: "Stop brief",
    idea: "A box for household tasks",
    client: createRecordedModelClient(),
  });
  for (const row of listStatements(db, sessionId, "proposed")) {
    approveStatement(db, row.id);
  }
  for (const row of listConcerns(db, sessionId, "proposed")) {
    approveConcern(db, row.id);
  }
  const codes = options.skipSuccess
    ? (["problem", "workflow"] as const)
    : (["problem", "workflow", "success"] as const);
  for (const code of codes) {
    approveConcern(
      db,
      proposeConcern(db, {
        sessionId,
        code,
        coverage: `Approved coverage for ${code}.`,
        provenanceSource: "user",
      }).id,
    );
  }
  return sessionId;
}

const stopClient = () =>
  createRecordedModelClient({
    questionPath: join(phase2, "fable-adaptive-stop.json"),
  });

describe("askAdaptiveQuestion deterministic stop", () => {
  test("brief D: a passing checklist yields no pending question and offers ready", async () => {
    const db = openMemoryLedger();
    const sessionId = await coveredSession(db);

    const { question, stop } = await askAdaptiveQuestion(db, {
      sessionId,
      client: stopClient(),
    });

    expect(question).toBeNull();
    expect(stop.passes).toBe(true);
    expect(listQuestions(db, sessionId)).toHaveLength(0);

    // The candidates persist for calibration even though none was asked.
    const candidates = db
      .prepare(
        "SELECT body, selected FROM question_candidates WHERE session_id = ?",
      )
      .all(sessionId) as { body: string; selected: number }[];
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.selected).toBe(0);
  });

  test("brief D variant: ready advice cannot offer ready past a missing core code", async () => {
    const db = openMemoryLedger();
    const sessionId = await coveredSession(db, { skipSuccess: true });

    // The fixture claims readyAdvice.ready: true; the checklist disagrees.
    const { question, stop } = await askAdaptiveQuestion(db, {
      sessionId,
      client: stopClient(),
    });

    expect(question).not.toBeNull();
    expect(stop.passes).toBe(false);
    expect(
      stop.items.find((item) => item.key === "core-coverage")?.evidence,
    ).toContain("success");
    expect(listQuestions(db, sessionId)).toHaveLength(1);
  });

  test("confirming framing does not lock further questions", async () => {
    const db = openMemoryLedger();
    const sessionId = await coveredSession(db);

    const first = await askAdaptiveQuestion(db, {
      sessionId,
      client: stopClient(),
    });
    expect(first.question).toBeNull();

    const { framedAt } = confirmFraming(db, sessionId);

    // After the user's explicit confirmation, asking again is a request to
    // continue: the same green checklist no longer suppresses the question.
    const second = await askAdaptiveQuestion(db, {
      sessionId,
      client: stopClient(),
    });
    expect(second.question).not.toBeNull();
    expect(second.question?.body).toContain("capture surface");
    expect(getFramedAt(db, sessionId)).toBe(framedAt);

    // The consultation loop still works end to end: the question resolves
    // like any other.
    resolveQuestion(db, {
      questionId: second.question!.id,
      disposition: "answered",
      body: "Email only for the first slice.",
    });
    expect(listQuestions(db, sessionId)[0]?.status).toBe("answered");
  });

  test("the payload's contradictions persist before the checklist is read", async () => {
    const db = openMemoryLedger();
    const sessionId = await coveredSession(db);

    // Same green session, but the payload carries a fresh tension citing the
    // two approved statements: item 2 must see it and withhold ready.
    const recorded = createRecordedModelClient();
    const { question, stop } = await askAdaptiveQuestion(db, {
      sessionId,
      client: recorded,
    });

    expect(stop.passes).toBe(false);
    expect(question).not.toBeNull();
    const open = listContradictions(db, sessionId, "open");
    expect(open).toHaveLength(1);
    const approvedIds = listStatements(db, sessionId, "approved").map(
      (row) => row.id,
    );
    const cited = JSON.parse(open[0]!.cited_statement_ids) as string[];
    for (const id of cited) {
      expect(approvedIds).toContain(id);
    }
    expect(open[0]?.model_call_id).not.toBeNull();
  });
});
