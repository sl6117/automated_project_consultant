import type Database from "better-sqlite3";
import { listConcerns } from "../ledger/concerns";
import { insertContradictions } from "../ledger/contradictions";
import {
  evaluateStopChecklist,
  getFramedAt,
  type StopChecklist,
} from "../ledger/framing";
import { insertQuestionCandidates } from "../ledger/question-candidates";
import {
  getPendingQuestion,
  listQuestions,
  proposeQuestion,
  type QuestionRow,
} from "../ledger/questions";
import {
  adaptiveNextQuestionOutputSchema,
  fableEnvelopeSchema,
  type AdaptiveNextQuestionOutput,
} from "../ledger/schemas";
import { listContradictions } from "../ledger/contradictions";
import { LedgerValidationError, listStatements } from "../ledger/statements";
import { runModelAttempt } from "./attempt-runner";
import type { ModelClient } from "./client";
import { describeNextQuestionRequest } from "./prompt";
import { CORE_CODES, rankCandidates, rubricExplanation } from "./rubric";

export class NextQuestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NextQuestionValidationError";
  }
}

// Asking the next question is gated on a clear review: the ranking input is
// canonical approved state, so pending proposals or an open question mean the
// ledger is not yet ready to rank against.
export class ConsultationNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConsultationNotReadyError";
  }
}

// The ledger moved while the model call was in flight, so the prompt no
// longer describes canonical state. The attempt receipt keeps the spend;
// nothing from the response applies. Asking again runs from current state.
export class StaleConsultationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleConsultationError";
  }
}

// Everything prompt-relevant, read in one deterministic structure: the
// approved slice, the adaptive context, and the two clear-review gates.
// Serialized before the model call and compared byte-for-byte inside the
// content transaction — any difference refuses the whole commit.
type PromptState = {
  approvedStatements: { id: string; body: string }[];
  approvedConcerns: { id: string; code: string; coverage: string }[];
  openContradictions: { id: string; summary: string }[];
  resolvedQuestions: { body: string; disposition: string }[];
  hasPendingQuestion: boolean;
  proposedRows: number;
};

function readPromptState(
  db: Database.Database,
  sessionId: string,
): PromptState {
  return {
    approvedStatements: listStatements(db, sessionId, "approved").map(
      (row) => ({ id: row.id, body: row.body }),
    ),
    approvedConcerns: listConcerns(db, sessionId, "approved").map((row) => ({
      id: row.id,
      code: row.code,
      coverage: row.coverage,
    })),
    openContradictions: listContradictions(db, sessionId, "open").map(
      (row) => ({ id: row.id, summary: row.summary }),
    ),
    resolvedQuestions: listQuestions(db, sessionId)
      .filter((question) => question.status !== "pending")
      .map((question) => ({
        body: question.body,
        disposition: question.answer?.disposition ?? question.status,
      })),
    hasPendingQuestion: getPendingQuestion(db, sessionId) !== null,
    proposedRows:
      listStatements(db, sessionId, "proposed").length +
      listConcerns(db, sessionId, "proposed").length,
  };
}

// Envelope, task tag, payload shape, then the contextual constraints the
// schema alone cannot check: every cited statement id must be an approved
// statement supplied in the prompt, and every contradiction target index must
// be in range. Any violation invalidates the WHOLE payload.
export function parseAdaptiveNextQuestion(
  payload: unknown,
  context: { approvedStatementIds: ReadonlySet<string> },
): AdaptiveNextQuestionOutput {
  const envelope = fableEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    throw new NextQuestionValidationError(envelope.error.message);
  }
  if (envelope.data.task !== "next_question") {
    throw new NextQuestionValidationError(
      `Expected task next_question, got ${envelope.data.task}`,
    );
  }
  const parsed = adaptiveNextQuestionOutputSchema.safeParse(
    envelope.data.payload,
  );
  if (!parsed.success) {
    throw new NextQuestionValidationError(parsed.error.message);
  }

  for (const contradiction of parsed.data.contradictions) {
    for (const id of contradiction.citedStatementIds) {
      if (!context.approvedStatementIds.has(id)) {
        throw new NextQuestionValidationError(
          `Contradiction cites unknown statement id ${id}`,
        );
      }
    }
  }
  const contradictionCount = parsed.data.contradictions.length;
  for (const candidate of parsed.data.candidates) {
    for (const index of candidate.targetsContradictionIndexes) {
      if (index >= contradictionCount) {
        throw new NextQuestionValidationError(
          `Candidate targets contradiction index ${index}, out of range`,
        );
      }
    }
  }

  return parsed.data;
}

// The Phase 2 adaptive path: runs only against a clear review, and its user
// message carries the approved ledger slice with row ids in the dynamic
// suffix. Every validated candidate persists — asked or not — with claimed
// and effective scores and both ranks; the rubric winner becomes the pending
// question with the rubric's explanation as why_selected.
//
// Slice 4 ordering rules: the payload's contradictions persist FIRST, and the
// stop checklist is evaluated only after that insert, so item 2 sees the
// newest tensions rather than stale rows. When the checklist passes on a
// not-yet-framed session, no pending question is inserted even though the
// candidates persist — inserting one would fail item 4 and bury the ready
// offer the user just earned. Once the user has confirmed framing, asking
// again is an explicit request to continue, so questions insert normally.
export async function askAdaptiveQuestion(
  db: Database.Database,
  input: {
    sessionId: string;
    client: ModelClient;
    confirmedOverCap?: boolean;
  },
): Promise<{ question: QuestionRow | null; stop: StopChecklist }> {
  const context = db
    .prepare(
      `SELECT s.initialization_status AS initialization_status,
              p.name AS project_name, p.idea AS idea
       FROM discovery_sessions s
       JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?`,
    )
    .get(input.sessionId) as
    | { initialization_status: string; project_name: string; idea: string }
    | undefined;
  if (!context) {
    throw new LedgerValidationError(`Session ${input.sessionId} not found`);
  }
  if (context.initialization_status !== "active") {
    throw new ConsultationNotReadyError(
      `Session ${input.sessionId} has not finished starting`,
    );
  }
  const state = readPromptState(db, input.sessionId);
  if (state.hasPendingQuestion) {
    throw new ConsultationNotReadyError(
      `Session ${input.sessionId} already has a pending question`,
    );
  }
  if (state.proposedRows > 0) {
    throw new ConsultationNotReadyError(
      `Session ${input.sessionId} has unreviewed proposals`,
    );
  }

  const approvedStatementIds = new Set(
    state.approvedStatements.map((row) => row.id),
  );
  const approvedConcernCodes = new Set(
    state.approvedConcerns.map((row) => row.code),
  );

  // The prompt is built from the SAME state object the commit later compares
  // against, so the snapshot covers exactly what the model saw. The adaptive
  // context beyond the approved slice: uncovered core codes (absence is the
  // gap), tensions already open so the model does not re-raise them under
  // new wording, and resolved questions so it does not ask them again. All
  // dynamic suffix material.
  const approved = {
    statements: state.approvedStatements,
    concerns: state.approvedConcerns,
  };
  const adaptiveContext = {
    missingCoreCodes: CORE_CODES.filter(
      (code) => !approvedConcernCodes.has(code),
    ),
    openContradictions: state.openContradictions,
    resolvedQuestions: state.resolvedQuestions,
  };
  const request = describeNextQuestionRequest({
    projectName: context.project_name,
    idea: context.idea,
    approved,
    context: adaptiveContext,
  });
  const promptSnapshot = JSON.stringify(state);

  const { value, attempt } = await runModelAttempt({
    db,
    sessionId: input.sessionId,
    alias: "fable",
    executionProvenance: input.client.executionProvenance,
    request,
    confirmedOverCap: input.confirmedOverCap,
    invoke: () =>
      input.client.nextQuestion({
        idea: context.idea,
        projectName: context.project_name,
        approved,
        context: adaptiveContext,
        request,
      }),
    parse: (payload) =>
      parseAdaptiveNextQuestion(payload, { approvedStatementIds }),
  });

  // readyAdvice is validated but deliberately not persisted or rendered in
  // Phase 2 (owner-ratified 2026-08-27): the spec's "may be shown as advice"
  // stays unexercised so no readiness signal exists outside the checklist.
  const ranked = rankCandidates(value, { approvedConcernCodes });
  const winner = ranked[0]!;

  const commit = db.transaction(() => {
    // Optimistic snapshot revalidation: re-read the complete prompt-relevant
    // state inside this transaction (synchronous, so race-free) and compare
    // it byte-for-byte with what the prompt was built from. Any drift —
    // statements, concern coverage, tensions, resolved questions, a new
    // pending question, or new proposals — refuses the whole content commit
    // atomically. The succeeded attempt receipt keeps the spend.
    if (JSON.stringify(readPromptState(db, input.sessionId)) !== promptSnapshot) {
      throw new StaleConsultationError(
        `The ledger for session ${input.sessionId} changed while the model call was in flight; nothing from the response was applied`,
      );
    }

    insertContradictions(db, {
      sessionId: input.sessionId,
      modelCallId: attempt.id,
      contradictions: value.contradictions,
    });

    const stop = evaluateStopChecklist(db, input.sessionId);
    const readyToOffer =
      stop.passes && getFramedAt(db, input.sessionId) === null;

    insertQuestionCandidates(db, {
      sessionId: input.sessionId,
      modelCallId: attempt.id,
      candidates: ranked.map((entry) => ({
        body: entry.candidate.body,
        modelWhySelected: entry.candidate.whySelected,
        concernCodes: entry.candidate.concernCodes,
        claimedCoreGap: entry.candidate.claimedScores.coreGap,
        claimedSliceBounding: entry.candidate.claimedScores.sliceBounding,
        claimedContradiction:
          entry.candidate.claimedScores.contradictionResolution,
        effectiveCoreGap: entry.scores.effectiveCoreGap,
        effectiveSliceBounding: entry.scores.effectiveSliceBounding,
        effectiveContradiction: entry.scores.effectiveContradiction,
        effectiveTotal: entry.scores.effectiveTotal,
        modelRank: entry.modelRank,
        rubricRank: entry.rubricRank,
        selected: !readyToOffer && entry === winner,
      })),
    });

    if (readyToOffer) {
      return { question: null, stop };
    }

    const question = proposeQuestion(db, {
      sessionId: input.sessionId,
      body: winner.candidate.body,
      whySelected: rubricExplanation(winner),
      provenanceSource: "model-inference",
      modelCallId: attempt.id,
    });
    // Inserting the question fails checklist item 4 by construction; report
    // the post-commit state honestly.
    return { question, stop: evaluateStopChecklist(db, input.sessionId) };
  });

  return commit();
}