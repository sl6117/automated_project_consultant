import type Database from "better-sqlite3";
import { listCoachNotes, type CoachNoteRow } from "./coach-notes";
import { listConcerns } from "./concerns";
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
};

export function getSessionDetail(
  db: Database.Database,
  sessionId: string,
): SessionDetail {
  const row = db
    .prepare(
      `SELECT
         s.id AS session_id,
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
  };
}
