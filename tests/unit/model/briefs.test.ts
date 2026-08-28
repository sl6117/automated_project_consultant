import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import {
  approveConcern,
  listConcerns,
  proposeConcern,
  rejectConcern,
} from "../../../src/server/ledger/concerns";
import { listContradictions } from "../../../src/server/ledger/contradictions";
import { listQuestions } from "../../../src/server/ledger/questions";
import {
  approveStatement,
  listStatements,
} from "../../../src/server/ledger/statements";
import { extractAndStartSession } from "../../../src/server/model/extract";
import { askAdaptiveQuestion } from "../../../src/server/model/next-question";
import { createRecordedModelClient } from "../../../src/server/model/recorded-client";

const phase2 = join(process.cwd(), "tests/fixtures/phase-2");

// The spec's minimum recorded set, run end to end: recorded fixture through
// the real parse → rank → persist pipeline, not rubric-only unit inputs.

function briefClient(name: string) {
  return createRecordedModelClient({
    questionPath: join(phase2, name),
  });
}

async function startCleared(db: ReturnType<typeof openMemoryLedger>) {
  const { sessionId } = await extractAndStartSession(db, {
    projectName: "Recorded briefs",
    idea: "A box for household tasks",
    client: createRecordedModelClient(),
  });
  for (const row of listStatements(db, sessionId, "proposed")) {
    approveStatement(db, row.id);
  }
  return sessionId;
}

function approveUserConcern(
  db: ReturnType<typeof openMemoryLedger>,
  sessionId: string,
  code: "problem" | "user" | "workflow" | "success",
) {
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

function persistedCandidates(
  db: ReturnType<typeof openMemoryLedger>,
  sessionId: string,
) {
  return db
    .prepare(
      "SELECT body, model_rank, rubric_rank, selected FROM question_candidates WHERE session_id = ? ORDER BY rubric_rank",
    )
    .all(sessionId) as {
    body: string;
    model_rank: number;
    rubric_rank: number;
    selected: number;
  }[];
}

describe("recorded briefs A-D end to end", () => {
  test("brief A: the missing-core candidate beats the model's first pick", async () => {
    const db = openMemoryLedger();
    const sessionId = await startCleared(db);
    // Approved coverage: problem and success only; user and workflow missing.
    for (const row of listConcerns(db, sessionId, "proposed")) {
      rejectConcern(db, row.id);
    }
    approveUserConcern(db, sessionId, "problem");
    approveUserConcern(db, sessionId, "success");

    const { question } = await askAdaptiveQuestion(db, {
      sessionId,
      client: briefClient("fable-adaptive-brief-a.json"),
    });

    expect(question?.body).toContain("Who operates the inbox");
    const candidates = persistedCandidates(db, sessionId);
    expect(candidates[0]?.model_rank).toBe(2);
    expect(candidates[0]?.rubric_rank).toBe(1);
    expect(candidates[0]?.selected).toBe(1);
    expect(candidates[1]?.model_rank).toBe(1);
  });

  test("brief B: highest claimed sliceBounding wins with the ontology tie-break", async () => {
    const db = openMemoryLedger();
    const sessionId = await startCleared(db);
    // All four core codes covered (extraction approves user; add the rest).
    for (const row of listConcerns(db, sessionId, "proposed")) {
      approveConcern(db, row.id);
    }
    approveUserConcern(db, sessionId, "problem");
    approveUserConcern(db, sessionId, "workflow");
    approveUserConcern(db, sessionId, "success");

    const { question, stop } = await askAdaptiveQuestion(db, {
      sessionId,
      client: briefClient("fable-adaptive-brief-b.json"),
    });

    // The green checklist withholds the question (brief D behavior), but the
    // ranking still persists in full for calibration.
    expect(question).toBeNull();
    expect(stop.passes).toBe(true);
    const candidates = persistedCandidates(db, sessionId);
    expect(candidates.map((row) => row.body)).toStrictEqual([
      "What single pain must the first slice remove completely?",
      "Does anyone besides the operator ever read the inbox?",
      "Should triage happen at a fixed time each day?",
    ]);
    // Tie at claimed 2 between workflow and user candidates: user comes
    // first in ontology order.
    expect(candidates.map((row) => row.model_rank)).toStrictEqual([2, 3, 1]);
  });

  test("brief C: targeting the open tension beats a higher slice-bounding claim", async () => {
    const db = openMemoryLedger();
    const sessionId = await startCleared(db);
    for (const row of listConcerns(db, sessionId, "proposed")) {
      approveConcern(db, row.id);
    }

    const { question } = await askAdaptiveQuestion(db, {
      sessionId,
      client: briefClient("fable-adaptive-brief-c.json"),
    });

    expect(question?.body).toContain("give way on capture reliability");
    const open = listContradictions(db, sessionId, "open");
    expect(open).toHaveLength(1);
    expect(open[0]?.summary).toContain("capture reliability as untested");
    expect(listQuestions(db, sessionId)).toHaveLength(1);
  });
});
