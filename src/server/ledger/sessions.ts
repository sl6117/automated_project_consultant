import type Database from "better-sqlite3";
import {
  listArtifactVersions,
  type ArtifactVersionRow,
} from "./artifact-versions";
import { listCoachNotes, type CoachNoteRow } from "./coach-notes";
import { listConcerns } from "./concerns";
import {
  citedStatementIdsOf,
  listContradictions,
  type ContradictionRow,
} from "./contradictions";
import { evaluateStopChecklist, type StopChecklist } from "./framing";
import { sessionSpend, type SessionSpend } from "./model-attempts";
import {
  listCandidatesForModelCall,
  type QuestionCandidateRow,
} from "./question-candidates";
import type { SessionInitializationStatus } from "./schemas";
import { listQuestions, type QuestionWithAnswer } from "./questions";
import { LedgerValidationError, listStatements } from "./statements";

export type SessionDetail = {
  sessionId: string;
  projectId: string;
  projectName: string;
  idea: string;
  proposedStatements: ReturnType<typeof listStatements>;
  approvedStatements: ReturnType<typeof listStatements>;
  proposedConcerns: ReturnType<typeof listConcerns>;
  approvedConcerns: ReturnType<typeof listConcerns>;
  pendingQuestion: QuestionWithAnswer | null;
  resolvedQuestions: QuestionWithAnswer[];
  coachNotes: CoachNoteRow[];
  artifactSets: ArtifactSet[];
  initializationStatus: SessionInitializationStatus;
  spend: SessionSpend;
  // Candidates from the adaptive call that produced the pending question.
  pendingCandidates: QuestionCandidateRow[];
  // Open tensions with their cited statements resolved to bodies for display;
  // closed rows stay in the ledger as provenance and surface only as a count.
  openTensions: OpenTension[];
  closedTensionCount: number;
  framedAt: string | null;
  stopChecklist: StopChecklist;
};

export type OpenTension = ContradictionRow & {
  citedStatements: { id: string; body: string; status: string }[];
};

export type ArtifactSet = {
  artifactSetId: string;
  createdAt: string;
  files: ArtifactVersionRow[];
};

// Rows arrive in chronological insertion order, so reversing the encounter
// order yields newest-first without relying on timestamp comparisons that tie
// within a millisecond.
function groupArtifactSets(rows: ArtifactVersionRow[]): ArtifactSet[] {
  const sets = new Map<string, ArtifactSet>();
  for (const row of rows) {
    const set = sets.get(row.artifact_set_id) ?? {
      artifactSetId: row.artifact_set_id,
      createdAt: row.created_at,
      files: [],
    };
    set.files.push(row);
    sets.set(row.artifact_set_id, set);
  }
  return [...sets.values()].reverse();
}

export function getSessionDetail(
  db: Database.Database,
  sessionId: string,
): SessionDetail {
  const row = db
    .prepare(
      `SELECT
         s.id AS session_id,
         s.initialization_status AS initialization_status,
         s.framed_at AS framed_at,
         p.id AS project_id,
         p.name AS project_name,
         p.idea AS idea
       FROM discovery_sessions s
       JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?`,
    )
    .get(sessionId) as
    | {
        session_id: string;
        initialization_status: SessionInitializationStatus;
        framed_at: string | null;
        project_id: string;
        project_name: string;
        idea: string;
      }
    | undefined;

  if (!row) {
    throw new LedgerValidationError(`Session ${sessionId} not found`);
  }

  const questions = listQuestions(db, sessionId);
  const pending = questions.find((question) => question.status === "pending");

  const allTensions = listContradictions(db, sessionId);
  const openTensions: OpenTension[] = allTensions
    .filter((tension) => tension.status === "open")
    .map((tension) => ({
      ...tension,
      citedStatements: citedStatementIdsOf(tension).flatMap((id) => {
        const statement = db
          .prepare("SELECT id, body, status FROM statements WHERE id = ?")
          .get(id) as { id: string; body: string; status: string } | undefined;
        return statement ? [statement] : [];
      }),
    }));

  return {
    sessionId: row.session_id,
    projectId: row.project_id,
    projectName: row.project_name,
    idea: row.idea,
    proposedStatements: listStatements(db, sessionId, "proposed"),
    approvedStatements: listStatements(db, sessionId, "approved"),
    proposedConcerns: listConcerns(db, sessionId, "proposed"),
    approvedConcerns: listConcerns(db, sessionId, "approved"),
    pendingQuestion: pending ?? null,
    resolvedQuestions: questions.filter(
      (question) => question.status !== "pending",
    ),
    coachNotes: listCoachNotes(db, sessionId),
    artifactSets: groupArtifactSets(listArtifactVersions(db, sessionId)),
    initializationStatus: row.initialization_status,
    spend: sessionSpend(db, sessionId),
    pendingCandidates: pending?.model_call_id
      ? listCandidatesForModelCall(db, pending.model_call_id)
      : [],
    openTensions,
    closedTensionCount: allTensions.length - openTensions.length,
    framedAt: row.framed_at,
    stopChecklist: evaluateStopChecklist(db, sessionId),
  };
}
