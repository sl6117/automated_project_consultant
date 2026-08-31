import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openMemoryLedger } from "../../../src/server/db/open";
import {
  approveConcern,
  listConcerns,
  proposeConcern,
} from "../../../src/server/ledger/concerns";
import { listContradictions } from "../../../src/server/ledger/contradictions";
import { sessionSpend } from "../../../src/server/ledger/model-attempts";
import { createProject, createSession } from "../../../src/server/ledger/projects";
import {
  getPendingQuestion,
  listQuestions,
  resolveQuestion,
} from "../../../src/server/ledger/questions";
import {
  approveStatement,
  listStatements,
  retractApprovedStatement,
} from "../../../src/server/ledger/statements";
import type { ModelClient } from "../../../src/server/model/client";
import {
  extractAndStartSession,
  retryStartSession,
} from "../../../src/server/model/extract";
import {
  ConsultationNotReadyError,
  NextQuestionValidationError,
  StaleConsultationError,
  askAdaptiveQuestion,
} from "../../../src/server/model/next-question";
import {
  buildSystemPrefix,
  describeNextQuestionRequest,
} from "../../../src/server/model/prompt";
import { createRecordedModelClient } from "../../../src/server/model/recorded-client";
import { createStubModelClient } from "../../../src/server/model/stub-client";
import { emptyAdaptiveContext } from "../helpers/adaptive-context";

const fixtureDir = join(process.cwd(), "tests/fixtures/phase-1");

type AttemptSummary = {
  model_alias: string;
  status: string;
  execution_provenance: string;
  recorded: number;
  confirmed_over_cap: number;
};

function attempts(
  db: ReturnType<typeof openMemoryLedger>,
  sessionId: string,
): AttemptSummary[] {
  return db
    .prepare(
      `SELECT model_alias, status, execution_provenance, recorded, confirmed_over_cap
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

function clearReview(
  db: ReturnType<typeof openMemoryLedger>,
  sessionId: string,
): void {
  for (const row of listStatements(db, sessionId, "proposed")) {
    approveStatement(db, row.id);
  }
  for (const row of listConcerns(db, sessionId, "proposed")) {
    approveConcern(db, row.id);
  }
}

describe("extractAndStartSession", () => {
  test("start is extraction only: proposals exist, no question row", async () => {
    const db = openMemoryLedger();
    const result = await extractAndStartSession(db, {
      projectName: "Life Admin Inbox",
      idea: "A box for household tasks",
      client: createRecordedModelClient(),
    });

    expect(result.initializationStatus).toBe("active");
    expect(result.failure).toBeNull();
    expect(sessionStatus(db, result.sessionId)).toBe("active");

    expect(listStatements(db, result.sessionId, "proposed")).toHaveLength(2);
    expect(listConcerns(db, result.sessionId, "proposed")).toHaveLength(2);
    // The first Fable question is deferred until review is clear.
    expect(listQuestions(db, result.sessionId)).toHaveLength(0);

    const calls = attempts(db, result.sessionId);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model_alias).toBe("sonnet");
    expect(calls[0]?.status).toBe("succeeded");
    expect(calls[0]?.execution_provenance).toBe("recorded");
  });

  test("an invalid extraction fails the start with one receipt and no content", async () => {
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

  test("a transport failure keeps its estimate reserved and fails the start", async () => {
    const db = openMemoryLedger();
    const broken = createRecordedModelClient();
    const client = {
      ...broken,
      async extractFromIdea(): Promise<never> {
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
      ["transport_failed"],
    );
    const spend = sessionSpend(db, result.sessionId);
    expect(spend.settledActualMicrocents).toBe(0);
    expect(spend.reservedEstimateMicrocents).toBeGreaterThan(0);
  });

  test("retry reuses the failed session and its cap", async () => {
    const db = openMemoryLedger();
    const failed = await extractAndStartSession(db, {
      projectName: "Retry flow",
      idea: "A box for household tasks",
      client: createRecordedModelClient({
        extractionPath: join(fixtureDir, "sonnet-extraction-invalid.json"),
      }),
    });
    expect(failed.initializationStatus).toBe("failed");

    const retried = await retryStartSession(db, {
      sessionId: failed.sessionId,
      client: createRecordedModelClient(),
    });

    expect(retried.sessionId).toBe(failed.sessionId);
    expect(retried.initializationStatus).toBe("active");
    const sessions = db
      .prepare("SELECT COUNT(*) AS n FROM discovery_sessions")
      .get() as { n: number };
    expect(sessions.n).toBe(1);
    expect(attempts(db, failed.sessionId).map((call) => call.status)).toStrictEqual(
      ["validation_failed", "succeeded"],
    );
    expect(listStatements(db, failed.sessionId, "proposed")).toHaveLength(2);
  });

  test("the over-cap confirmation threads from retry to the attempt row", async () => {
    const db = openMemoryLedger();
    const project = createProject(db, "Over cap", "A box for household tasks");
    const session = createSession(db, project.id, 1);

    const refused = await retryStartSession(db, {
      sessionId: session.id,
      client: createRecordedModelClient(),
    });
    expect(refused.failure).toBe("cost-cap");
    expect(attempts(db, session.id)).toHaveLength(0);

    const confirmed = await retryStartSession(db, {
      sessionId: session.id,
      client: createRecordedModelClient(),
      confirmedOverCap: true,
    });
    expect(confirmed.initializationStatus).toBe("active");
    const calls = attempts(db, session.id);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.confirmed_over_cap).toBe(1);
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

  test("stub extraction quotes the submitted title and idea, without a question", async () => {
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
    expect(listQuestions(db, result.sessionId)).toHaveLength(0);
  });
});

describe("askAdaptiveQuestion", () => {
  async function startActive(db: ReturnType<typeof openMemoryLedger>) {
    const result = await extractAndStartSession(db, {
      projectName: "Life Admin Inbox",
      idea: "A box for household tasks",
      client: createRecordedModelClient(),
    });
    return result.sessionId;
  }

  test("is gated until every proposal is reviewed", async () => {
    const db = openMemoryLedger();
    const sessionId = await startActive(db);

    await expect(
      askAdaptiveQuestion(db, {
        sessionId,
        client: createRecordedModelClient(),
      }),
    ).rejects.toThrow(ConsultationNotReadyError);
    // The gate fires before any model bookkeeping: still only the extraction
    // receipt.
    expect(attempts(db, sessionId)).toHaveLength(1);
  });

  test("a clear review yields the pending question and a fable receipt", async () => {
    const db = openMemoryLedger();
    const sessionId = await startActive(db);
    clearReview(db, sessionId);

    const { question } = await askAdaptiveQuestion(db, {
      sessionId,
      client: createRecordedModelClient(),
    });

    expect(question).not.toBeNull();
    expect(question!.session_id).toBe(sessionId);
    expect(question!.body).toContain("Who captures incoming household tasks");
    expect(question!.provenance_source).toBe("model-inference");
    expect(getPendingQuestion(db, sessionId)?.id).toBe(question!.id);

    const calls = attempts(db, sessionId);
    expect(calls.map((call) => call.model_alias)).toStrictEqual([
      "sonnet",
      "fable",
    ]);
    expect(calls[1]?.status).toBe("succeeded");

    // A second ask is blocked while the question is pending.
    await expect(
      askAdaptiveQuestion(db, {
        sessionId,
        client: createRecordedModelClient(),
      }),
    ).rejects.toThrow(ConsultationNotReadyError);
  });

  test("the user message carries approved row ids; the prefix does not", async () => {
    const db = openMemoryLedger();
    const sessionId = await startActive(db);
    clearReview(db, sessionId);
    const approvedStatement = listStatements(db, sessionId, "approved")[0]!;
    const approvedConcern = listConcerns(db, sessionId, "approved")[0]!;

    const capture: { message?: string } = {};
    const recorded = createRecordedModelClient();
    const client: ModelClient = {
      ...recorded,
      async nextQuestion(input) {
        capture.message = input.request.messages[0]?.content;
        return recorded.nextQuestion(input);
      },
    };

    await askAdaptiveQuestion(db, { sessionId, client });

    expect(capture.message).toContain(`[${approvedStatement.id}]`);
    expect(capture.message).toContain(approvedStatement.body);
    expect(capture.message).toContain(`[${approvedConcern.id}]`);

    // Ledger state never reaches the cached prefix.
    const prefix = buildSystemPrefix()
      .map((block) => block.text)
      .join("\n");
    expect(prefix).not.toContain(approvedStatement.id);
    expect(prefix).not.toContain(approvedStatement.body);
  });

  test("the user message names missing cores, open tensions, and resolved questions", async () => {
    const db = openMemoryLedger();
    const sessionId = await startActive(db);
    clearReview(db, sessionId);

    // First ask persists the fixture's tension and a pending question;
    // resolving the question makes it context for the next call.
    const first = await askAdaptiveQuestion(db, {
      sessionId,
      client: createRecordedModelClient(),
    });
    resolveQuestion(db, {
      questionId: first.question!.id,
      disposition: "answered",
      body: "One shared inbox, triaged daily.",
    });

    const capture: { message?: string } = {};
    const recorded = createRecordedModelClient();
    const client: ModelClient = {
      ...recorded,
      async nextQuestion(input) {
        capture.message = input.request.messages[0]?.content;
        return recorded.nextQuestion(input);
      },
    };
    await askAdaptiveQuestion(db, { sessionId, client });

    // Missing cores (absence is the gap), the open tension by id and
    // summary, and the resolved question all reach the dynamic suffix.
    expect(capture.message).toContain("Missing core concern codes");
    expect(capture.message).toContain("- problem");
    expect(capture.message).toContain("- workflow");
    expect(capture.message).toContain("- success");
    const tension = listContradictions(db, sessionId, "open")[0]!;
    expect(capture.message).toContain(`[${tension.id}] ${tension.summary}`);
    expect(capture.message).toContain(
      "answered: Who captures incoming household tasks today",
    );

    // None of it leaks into the cached prefix.
    const prefix = buildSystemPrefix()
      .map((block) => block.text)
      .join("\n");
    expect(prefix).not.toContain(tension.summary);
    expect(prefix).not.toContain(tension.id);
  });

  test("a fixture placeholder with no matching approved statement fails loudly", async () => {
    // One approved statement, but the default fixture cites placeholders 0
    // AND 1: the recorded client must refuse rather than leak the raw
    // placeholder into validation as a misleading unknown-id error.
    const request = describeNextQuestionRequest({
      projectName: "Sparse",
      idea: "an idea",
      approved: {
        statements: [{ id: "only-one", body: "The only approved statement." }],
        concerns: [],
      },
      context: emptyAdaptiveContext(),
    });

    await expect(
      createRecordedModelClient().nextQuestion({
        idea: "an idea",
        projectName: "Sparse",
        approved: {
          statements: [
            { id: "only-one", body: "The only approved statement." },
          ],
          concerns: [],
        },
        context: emptyAdaptiveContext(),
        request,
      }),
    ).rejects.toThrow(/placeholder with no/);
  });

  // A schema-valid payload for the mid-call mutation tests: no contradictions,
  // so only the snapshot comparison — not citation validation — can catch
  // ledger drift.
  function validEnvelope() {
    return {
      payload: {
        task: "next_question",
        payload: {
          candidates: [
            {
              body: "A valid question?",
              whySelected: "Valid reason.",
              concernCodes: ["workflow"],
              claimedScores: {
                coreGap: 3,
                sliceBounding: 2,
                contradictionResolution: 0,
              },
              targetsContradictionIndexes: [],
            },
          ],
          contradictions: [],
          readyAdvice: { ready: false, why: "advisory" },
        },
      },
      usage: null,
    };
  }

  function expectNothingApplied(
    db: ReturnType<typeof openMemoryLedger>,
    sessionId: string,
  ) {
    // The receipt keeps the spend; no content of any kind was applied.
    expect(listQuestions(db, sessionId)).toHaveLength(0);
    expect(listContradictions(db, sessionId)).toHaveLength(0);
    const candidateCount = db
      .prepare(
        "SELECT COUNT(*) AS n FROM question_candidates WHERE session_id = ?",
      )
      .get(sessionId) as { n: number };
    expect(candidateCount.n).toBe(0);
    const calls = attempts(db, sessionId);
    expect(calls[1]?.status).toBe("succeeded");
  }

  test("a cited statement retracted mid-call refuses the whole content commit", async () => {
    const db = openMemoryLedger();
    const sessionId = await startActive(db);
    clearReview(db, sessionId);
    const citedIds = listStatements(db, sessionId, "approved").map(
      (row) => row.id,
    );

    const recorded = createRecordedModelClient();
    const client: ModelClient = {
      ...recorded,
      async nextQuestion() {
        // The ledger moves while the model call is in flight.
        retractApprovedStatement(db, citedIds[0]!);
        const envelope = validEnvelope();
        envelope.payload.payload.contradictions = [
          {
            summary: "Cites ids that were approved when prompted.",
            citedStatementIds: citedIds,
          },
        ] as never;
        return envelope;
      },
    };

    await expect(
      askAdaptiveQuestion(db, { sessionId, client }),
    ).rejects.toThrow(StaleConsultationError);
    expectNothingApplied(db, sessionId);
  });

  test("an UNCITED approved statement changing mid-call also refuses the commit", async () => {
    const db = openMemoryLedger();
    const sessionId = await startActive(db);
    clearReview(db, sessionId);
    const approvedIds = listStatements(db, sessionId, "approved").map(
      (row) => row.id,
    );

    const recorded = createRecordedModelClient();
    const client: ModelClient = {
      ...recorded,
      async nextQuestion() {
        // The payload cites nothing, so citation checks alone would let this
        // through; the snapshot comparison must not.
        retractApprovedStatement(db, approvedIds[1]!);
        return validEnvelope();
      },
    };

    await expect(
      askAdaptiveQuestion(db, { sessionId, client }),
    ).rejects.toThrow(StaleConsultationError);
    expectNothingApplied(db, sessionId);
  });

  test("concern coverage changing mid-call refuses the commit", async () => {
    const db = openMemoryLedger();
    const sessionId = await startActive(db);
    clearReview(db, sessionId);

    const recorded = createRecordedModelClient();
    const client: ModelClient = {
      ...recorded,
      async nextQuestion() {
        // Approved concern coverage grows mid-call (net proposals return to
        // zero, so only the coverage comparison can catch it).
        approveConcern(
          db,
          proposeConcern(db, {
            sessionId,
            code: "workflow",
            coverage: "Coverage added while the model was thinking.",
            provenanceSource: "user",
          }).id,
        );
        return validEnvelope();
      },
    };

    await expect(
      askAdaptiveQuestion(db, { sessionId, client }),
    ).rejects.toThrow(StaleConsultationError);
    expectNothingApplied(db, sessionId);
  });

  test("persists every candidate with claimed and effective scores and both ranks", async () => {
    const db = openMemoryLedger();
    const sessionId = await startActive(db);
    clearReview(db, sessionId);

    const { question } = await askAdaptiveQuestion(db, {
      sessionId,
      client: createRecordedModelClient(),
    });

    // The fixture's model rank 1 candidate loses to the missing-core-code
    // candidate; the rubric explanation becomes why_selected.
    expect(question!.body).toContain("Who captures incoming household tasks");
    expect(question!.why_selected).toContain("Rubric winner");
    expect(question!.why_selected).toContain("Model ranked it #2");

    const candidates = db
      .prepare(
        "SELECT * FROM question_candidates WHERE session_id = ? ORDER BY rubric_rank",
      )
      .all(sessionId) as {
      body: string;
      model_rank: number;
      rubric_rank: number;
      selected: number;
      claimed_core_gap: number;
      effective_core_gap: number;
      effective_slice_bounding: number;
      effective_total: number;
      model_why_selected: string;
    }[];
    expect(candidates).toHaveLength(2);

    const winner = candidates[0]!;
    expect(winner.selected).toBe(1);
    expect(winner.model_rank).toBe(2);
    expect(winner.rubric_rank).toBe(1);
    // workflow is a missing core code: effective 3 overrides the claimed 1.
    expect(winner.claimed_core_gap).toBe(1);
    expect(winner.effective_core_gap).toBe(3);
    expect(winner.effective_total).toBe(5);
    expect(winner.model_why_selected).toContain("operator or capture surface");

    const loser = candidates[1]!;
    expect(loser.selected).toBe(0);
    expect(loser.model_rank).toBe(1);
    expect(loser.rubric_rank).toBe(2);
    // non-goals is approved in the fixture: effective 0 despite claimed 2.
    expect(loser.effective_core_gap).toBe(0);
    expect(loser.effective_total).toBe(3);
  });

  test("an unknown cited statement id invalidates the whole payload", async () => {
    const db = openMemoryLedger();
    const sessionId = await startActive(db);
    clearReview(db, sessionId);

    const recorded = createRecordedModelClient();
    const client: ModelClient = {
      ...recorded,
      async nextQuestion() {
        return {
          payload: {
            task: "next_question",
            payload: {
              candidates: [
                {
                  body: "A valid question?",
                  whySelected: "Valid reason.",
                  concernCodes: ["workflow"],
                  claimedScores: {
                    coreGap: 3,
                    sliceBounding: 2,
                    contradictionResolution: 0,
                  },
                  targetsContradictionIndexes: [],
                },
              ],
              contradictions: [
                {
                  summary: "Cites a statement the prompt never supplied.",
                  citedStatementIds: ["ghost-id-1", "ghost-id-2"],
                },
              ],
              readyAdvice: { ready: false, why: "advisory" },
            },
          },
          usage: null,
        };
      },
    };

    await expect(
      askAdaptiveQuestion(db, { sessionId, client }),
    ).rejects.toThrow(/unknown statement id/);
    expect(listQuestions(db, sessionId)).toHaveLength(0);
    const count = db
      .prepare(
        "SELECT COUNT(*) AS n FROM question_candidates WHERE session_id = ?",
      )
      .get(sessionId) as { n: number };
    expect(count.n).toBe(0);
  });

  test("an out-of-range contradiction target invalidates the whole payload", async () => {
    const db = openMemoryLedger();
    const sessionId = await startActive(db);
    clearReview(db, sessionId);

    const recorded = createRecordedModelClient();
    const client: ModelClient = {
      ...recorded,
      async nextQuestion() {
        return {
          payload: {
            task: "next_question",
            payload: {
              candidates: [
                {
                  body: "A valid question?",
                  whySelected: "Valid reason.",
                  concernCodes: ["workflow"],
                  claimedScores: {
                    coreGap: 3,
                    sliceBounding: 2,
                    contradictionResolution: 3,
                  },
                  targetsContradictionIndexes: [0],
                },
              ],
              contradictions: [],
              readyAdvice: { ready: false, why: "advisory" },
            },
          },
          usage: null,
        };
      },
    };

    await expect(
      askAdaptiveQuestion(db, { sessionId, client }),
    ).rejects.toThrow(/out of range/);
    expect(listQuestions(db, sessionId)).toHaveLength(0);
  });

  test("a wrong-task envelope persists nothing and keeps the session active", async () => {
    const db = openMemoryLedger();
    const sessionId = await startActive(db);
    clearReview(db, sessionId);

    await expect(
      askAdaptiveQuestion(db, {
        sessionId,
        client: createRecordedModelClient({
          questionPath: join(fixtureDir, "fable-coach.json"),
        }),
      }),
    ).rejects.toThrow(NextQuestionValidationError);

    expect(listQuestions(db, sessionId)).toHaveLength(0);
    expect(sessionStatus(db, sessionId)).toBe("active");
    const calls = attempts(db, sessionId);
    expect(calls[1]?.status).toBe("validation_failed");
  });

  test("an unknown session fails before any model bookkeeping", async () => {
    const db = openMemoryLedger();
    await expect(
      askAdaptiveQuestion(db, {
        sessionId: "missing",
        client: createRecordedModelClient(),
      }),
    ).rejects.toThrow(/not found/);
  });
});
