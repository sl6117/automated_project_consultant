import type Database from "better-sqlite3";
import { compileArtifacts } from "../server/artifacts/compiler";
import { recordArtifactSet } from "../server/ledger/artifact-versions";
import { approveConcern, listConcerns } from "../server/ledger/concerns";
import {
  citedStatementIdsOf,
  dismissContradiction,
  listContradictions,
} from "../server/ledger/contradictions";
import { confirmFraming } from "../server/ledger/framing";
import { listCandidatesForModelCall } from "../server/ledger/question-candidates";
import { resolveQuestion } from "../server/ledger/questions";
import { approveStatement, listStatements } from "../server/ledger/statements";
import { openMemoryLedger } from "../server/db/open";
import type { ModelClient } from "../server/model/client";
import { extractAndStartSession } from "../server/model/extract";
import { proposeFromAnswer } from "../server/model/incremental";
import { askAdaptiveQuestion } from "../server/model/next-question";
import { CORE_CODES } from "../server/model/rubric";
import type { Brief } from "./corpus-schemas";
import { createPersona } from "./persona";
import {
  createReplayModelClient,
  RecordingMissError,
} from "./replay-client";
import type { LoadedRun } from "./recordings";

// Drives one brief through the REAL Phase 2 pipeline — real ledger, real
// validation, real prompt builders — with the scripted persona standing in
// for the user. The driver's user-side policy is fixed so replay is
// deterministic: every proposed statement and concern is approved, every
// raised tension is dismissed after being recorded (a user action, as the
// contract requires), the ready offer is accepted immediately, and answers
// come from the persona's ordered script. Turn accounting: a turn is an ask
// that produced a pending question; the ready offer at N answered turns is
// "offered at turn N + 1". Reaching the brief's max turn count ends the
// replay as a missed stop — never a harness error.

export type TurnRecord = {
  turn: number;
  questionBody: string;
  concernCodes: string[];
  answerDisposition: "answered" | "unknown";
  answerBody: string;
  tensionsRaised: { summary: string; citedStatementIds: string[] }[];
};

export type ReplayOutcome =
  | "stopped"
  | "missed-stop"
  | "start-failed"
  | "aborted-validation";

export type ReplayTranscript = {
  briefId: string;
  outcome: ReplayOutcome;
  turns: TurnRecord[];
  stopOfferedAtTurn: number | null;
  // Turn after which all four core codes held approved coverage (0 = covered
  // by the initial extraction alone); null if never completed.
  coreCoveredAtTurn: number | null;
  framedAt: string | null;
  approvedStatements: { kind: string; body: string }[];
  approvedConcernCodes: string[];
  tensionsRaisedTotal: number;
  artifacts: { filename: string; body: string }[];
  attemptOutcomes: { alias: string; status: string }[];
  failureDetail: string | null;
};

function approveAllProposals(db: Database.Database, sessionId: string): void {
  for (const row of listStatements(db, sessionId, "proposed")) {
    approveStatement(db, row.id);
  }
  for (const row of listConcerns(db, sessionId, "proposed")) {
    approveConcern(db, row.id);
  }
}

function dismissOpenTensions(db: Database.Database, sessionId: string): void {
  for (const row of listContradictions(db, sessionId, "open")) {
    dismissContradiction(db, row.id);
  }
}

function readAttemptOutcomes(
  db: Database.Database,
  sessionId: string,
): { alias: string; status: string }[] {
  return db
    .prepare(
      "SELECT model_alias AS alias, status FROM model_calls WHERE session_id = ? ORDER BY created_at, rowid",
    )
    .all(sessionId) as { alias: string; status: string }[];
}

// Replays one brief against a loaded run and enforces the run-rejection
// contract: a single hash miss rejects the whole evaluation rather than
// letting the miss masquerade as a transport failure in the transcript (the
// attempt runner classifies any invoke error as transport, so the client's
// side channel is the reliable signal).
export async function replayBriefAgainstRun(input: {
  brief: Brief;
  run: LoadedRun;
}): Promise<ReplayTranscript> {
  const client = createReplayModelClient(input.run);
  const transcript = await replayBrief({ brief: input.brief, client });
  if (client.misses.length > 0) {
    throw client.misses[0]!;
  }
  return transcript;
}

export async function replayBrief(input: {
  brief: Brief;
  client: ModelClient;
}): Promise<ReplayTranscript> {
  // The in-memory ledger holds a native better-sqlite3 handle; leaving it
  // open leaks across test workers and crashes vitest's forks pool at
  // teardown on Linux CI. Close it on every path, success or throw.
  const db = openMemoryLedger();
  try {
    return await replayBriefWithLedger(input, db);
  } finally {
    db.close();
  }
}

async function replayBriefWithLedger(
  input: { brief: Brief; client: ModelClient },
  db: ReturnType<typeof openMemoryLedger>,
): Promise<ReplayTranscript> {
  const { brief, client } = input;
  const persona = createPersona(brief);
  const turns: TurnRecord[] = [];
  let coreCoveredAtTurn: number | null = null;

  const noteCoreCoverage = (sessionId: string): void => {
    if (coreCoveredAtTurn !== null) {
      return;
    }
    const approved = new Set(
      listConcerns(db, sessionId, "approved").map((row) => row.code),
    );
    if (CORE_CODES.every((code) => approved.has(code))) {
      coreCoveredAtTurn = turns.length;
    }
  };

  const finalize = (
    sessionId: string,
    outcome: ReplayOutcome,
    extra: {
      stopOfferedAtTurn?: number | null;
      framedAt?: string | null;
      artifacts?: { filename: string; body: string }[];
      failureDetail?: string | null;
    },
  ): ReplayTranscript => ({
    briefId: brief.id,
    outcome,
    turns,
    stopOfferedAtTurn: extra.stopOfferedAtTurn ?? null,
    coreCoveredAtTurn,
    framedAt: extra.framedAt ?? null,
    approvedStatements: listStatements(db, sessionId, "approved").map(
      (row) => ({ kind: row.kind, body: row.body }),
    ),
    approvedConcernCodes: listConcerns(db, sessionId, "approved").map(
      (row) => row.code,
    ),
    tensionsRaisedTotal: listContradictions(db, sessionId).length,
    artifacts: extra.artifacts ?? [],
    attemptOutcomes: readAttemptOutcomes(db, sessionId),
    failureDetail: extra.failureDetail ?? null,
  });

  const start = await extractAndStartSession(db, {
    projectName: brief.projectName,
    idea: brief.idea,
    client,
  });
  if (start.failure !== null) {
    return finalize(start.sessionId, "start-failed", {
      failureDetail: `session start failed: ${start.failure}`,
    });
  }
  const sessionId = start.sessionId;
  approveAllProposals(db, sessionId);
  noteCoreCoverage(sessionId);

  for (;;) {
    if (turns.length >= brief.maxTurns) {
      return finalize(sessionId, "missed-stop", {});
    }

    const tensionsBeforeAsk = listContradictions(db, sessionId).length;
    let asked;
    try {
      asked = await askAdaptiveQuestion(db, { sessionId, client });
    } catch (error) {
      if (error instanceof RecordingMissError) {
        throw error;
      }
      return finalize(sessionId, "aborted-validation", {
        failureDetail: error instanceof Error ? error.message : String(error),
      });
    }

    if (asked.question === null) {
      const framed = confirmFraming(db, sessionId);
      const files = compileArtifacts(db, sessionId);
      recordArtifactSet(db, { sessionId, files });
      return finalize(sessionId, "stopped", {
        stopOfferedAtTurn: turns.length + 1,
        framedAt: framed.framedAt,
        artifacts: files,
      });
    }

    const question = asked.question;
    const selected = listCandidatesForModelCall(
      db,
      question.model_call_id ?? "",
    ).find((candidate) => candidate.selected === 1);
    const concernCodes = selected
      ? (JSON.parse(selected.concern_codes) as string[])
      : [];

    // Tensions raised by THIS ask were inserted just before the question.
    const tensionsRaised = listContradictions(db, sessionId)
      .slice(tensionsBeforeAsk)
      .map((row) => ({
        summary: row.summary,
        citedStatementIds: citedStatementIdsOf(row),
      }));

    const answer = persona.answerFor(concernCodes);
    resolveQuestion(db, {
      questionId: question.id,
      disposition: answer.disposition,
      body: answer.body,
    });

    try {
      await proposeFromAnswer(db, { questionId: question.id, client });
    } catch (error) {
      if (error instanceof RecordingMissError) {
        throw error;
      }
      return finalize(sessionId, "aborted-validation", {
        failureDetail: error instanceof Error ? error.message : String(error),
      });
    }
    approveAllProposals(db, sessionId);

    turns.push({
      turn: turns.length + 1,
      questionBody: question.body,
      concernCodes,
      answerDisposition: answer.disposition,
      answerBody: answer.body,
      tensionsRaised,
    });
    // Noted after the push so the recorded turn number includes this turn's
    // approvals.
    noteCoreCoverage(sessionId);

    // Raised tensions are recorded above, then closed by explicit (simulated)
    // user action so the checklist can pass once coverage is complete.
    dismissOpenTensions(db, sessionId);
  }
}
