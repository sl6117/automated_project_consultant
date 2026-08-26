import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { nowIso } from "./projects";
import {
  proposeQuestionSchema,
  resolveQuestionSchema,
  type ProposeQuestionInput,
  type QuestionDisposition,
  type StatementKind,
} from "./schemas";
import {
  LedgerValidationError,
  approveStatement,
  proposeStatement,
  type StatementRow,
} from "./statements";

export type QuestionRow = {
  id: string;
  session_id: string;
  body: string;
  why_selected: string;
  status: "pending" | "answered" | "superseded";
  provenance_source: "user" | "model-inference";
  model_call_id: string | null;
  created_at: string;
};

export type AnswerRow = {
  id: string;
  question_id: string;
  body: string;
  disposition: QuestionDisposition | null;
  provenance_source: "user" | "model-inference";
  created_at: string;
};

export type QuestionWithAnswer = QuestionRow & {
  answer: AnswerRow | null;
};

function statementKindForDisposition(
  disposition: QuestionDisposition,
): StatementKind {
  if (disposition === "unknown") {
    return "unknown";
  }
  if (disposition === "deferred") {
    return "deferred";
  }
  return "decision";
}

function resolvedAnswerBody(
  question: QuestionRow,
  disposition: QuestionDisposition,
  body: string,
): string {
  const trimmed = body.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  if (disposition === "unknown") {
    return `Unknown: ${question.body}`;
  }
  if (disposition === "deferred") {
    return `Deferred: ${question.body}`;
  }
  return trimmed;
}

export function proposeQuestion(
  db: Database.Database,
  input: ProposeQuestionInput,
): QuestionRow {
  const parsed = proposeQuestionSchema.safeParse(input);
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const pending = getPendingQuestion(db, parsed.data.sessionId);
  if (pending) {
    throw new LedgerValidationError(
      `Session ${parsed.data.sessionId} already has a pending question`,
    );
  }

  const id = randomUUID();
  const createdAt = nowIso();

  try {
    db.prepare(
      `INSERT INTO questions (
        id, session_id, body, why_selected, status, provenance_source, model_call_id, created_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(
      id,
      parsed.data.sessionId,
      parsed.data.body,
      parsed.data.whySelected,
      parsed.data.provenanceSource,
      parsed.data.modelCallId ?? null,
      createdAt,
    );
  } catch (error) {
    throw new LedgerValidationError(
      error instanceof Error ? error.message : "Question write failed",
    );
  }

  return getQuestion(db, id);
}

export function getQuestion(db: Database.Database, id: string): QuestionRow {
  const row = db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as
    | QuestionRow
    | undefined;
  if (!row) {
    throw new LedgerValidationError(`Question ${id} not found`);
  }
  return row;
}

export function getPendingQuestion(
  db: Database.Database,
  sessionId: string,
): QuestionRow | null {
  const row = db
    .prepare(
      "SELECT * FROM questions WHERE session_id = ? AND status = 'pending' ORDER BY created_at LIMIT 1",
    )
    .get(sessionId) as QuestionRow | undefined;
  return row ?? null;
}

export function listQuestions(
  db: Database.Database,
  sessionId: string,
): QuestionWithAnswer[] {
  const questions = db
    .prepare(
      "SELECT * FROM questions WHERE session_id = ? ORDER BY created_at",
    )
    .all(sessionId) as QuestionRow[];

  return questions.map((question) => ({
    ...question,
    answer: getAnswerForQuestion(db, question.id),
  }));
}

function getAnswerForQuestion(
  db: Database.Database,
  questionId: string,
): AnswerRow | null {
  const row = db
    .prepare(
      "SELECT * FROM answers WHERE question_id = ? ORDER BY created_at LIMIT 1",
    )
    .get(questionId) as AnswerRow | undefined;
  return row ?? null;
}

export function resolveQuestion(
  db: Database.Database,
  input: {
    questionId: string;
    disposition: string;
    body: string;
  },
): { question: QuestionRow; answer: AnswerRow; statement: StatementRow } {
  const parsed = resolveQuestionSchema.safeParse(input);
  if (!parsed.success) {
    throw new LedgerValidationError(parsed.error.message);
  }

  const run = db.transaction(() => {
    const question = getQuestion(db, parsed.data.questionId);
    if (question.status !== "pending") {
      throw new LedgerValidationError(
        `Question ${question.id} is ${question.status}, not pending`,
      );
    }

    const answerBody = resolvedAnswerBody(
      question,
      parsed.data.disposition,
      parsed.data.body,
    );
    const answerId = randomUUID();
    const createdAt = nowIso();

    db.prepare(
      `INSERT INTO answers (
        id, question_id, body, disposition, provenance_source, created_at
      ) VALUES (?, ?, ?, ?, 'user', ?)`,
    ).run(answerId, question.id, answerBody, parsed.data.disposition, createdAt);

    db.prepare("UPDATE questions SET status = 'answered' WHERE id = ?").run(
      question.id,
    );

    const proposed = proposeStatement(db, {
      sessionId: question.session_id,
      kind: statementKindForDisposition(parsed.data.disposition),
      body: answerBody,
      provenanceSource: "user",
    });
    const statement = approveStatement(db, proposed.id);

    const answer = db
      .prepare("SELECT * FROM answers WHERE id = ?")
      .get(answerId) as AnswerRow;

    return {
      question: getQuestion(db, question.id),
      answer,
      statement,
    };
  });

  return run();
}
