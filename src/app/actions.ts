"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAppDb } from "@/server/db/app-db";
import { promoteCoachNote } from "@/server/ledger/coach-notes";
import {
  approveConcern,
  editConcern,
  rejectConcern,
} from "@/server/ledger/concerns";
import { CostCapError } from "@/server/ledger/cost";
import { CoachValidationError, requestCoaching } from "@/server/model/coach";
import { resolveQuestion } from "@/server/ledger/questions";
import {
  LedgerValidationError,
  approveStatement,
  editStatement,
  rejectStatement,
} from "@/server/ledger/statements";
import {
  ExtractionValidationError,
  extractAndStartSession,
} from "@/server/model/extract";
import { resolveModelClient } from "@/server/model/mode";
import { NextQuestionValidationError } from "@/server/model/next-question";

export type ActionState = { error: string | null };

// Domain failures are expected outcomes of normal use (stale pages, empty
// input, invalid model output). They become safe action state; anything else
// rethrows to the error boundary. Raw error text never reaches the client.
function domainErrorMessage(error: unknown): string | null {
  if (error instanceof CostCapError) {
    return "This would exceed the session model budget cap, which needs explicit confirmation.";
  }
  if (
    error instanceof ExtractionValidationError ||
    error instanceof NextQuestionValidationError ||
    error instanceof CoachValidationError
  ) {
    return "The model returned output that failed validation. Nothing was saved.";
  }
  if (error instanceof LedgerValidationError) {
    return "That item has already been reviewed or no longer exists. Reload the page to see its current state.";
  }
  return null;
}

export async function createConsultationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const idea = String(formData.get("idea") ?? "").trim();

  if (!name || !idea) {
    return { error: "Project name and rough idea are both required." };
  }

  let sessionId: string;
  try {
    ({ sessionId } = extractAndStartSession(getAppDb(), {
      projectName: name,
      idea,
      client: resolveModelClient(),
    }));
  } catch (error) {
    const message = domainErrorMessage(error);
    if (message) {
      return { error: message };
    }
    throw error;
  }

  redirect(`/sessions/${sessionId}`);
}

export async function reviewStatementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const statementId = String(formData.get("statementId") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  const db = getAppDb();
  let sessionId: string;
  try {
    if (intent === "approve") {
      sessionId = approveStatement(db, statementId).session_id;
    } else if (intent === "reject") {
      sessionId = rejectStatement(db, statementId).session_id;
    } else if (intent === "edit") {
      if (!body) {
        return { error: "Type the corrected statement before saving an edit." };
      }
      sessionId = editStatement(db, { statementId, body }).revised.session_id;
    } else {
      throw new Error(`Unsupported statement review intent: ${intent}`);
    }
  } catch (error) {
    const message = domainErrorMessage(error);
    if (message) {
      return { error: message };
    }
    throw error;
  }

  revalidatePath(`/sessions/${sessionId}`);
  return { error: null };
}

export async function reviewConcernAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const concernId = String(formData.get("concernId") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const coverage = String(formData.get("coverage") ?? "").trim();

  const db = getAppDb();
  let sessionId: string;
  try {
    if (intent === "approve") {
      sessionId = approveConcern(db, concernId).session_id;
    } else if (intent === "reject") {
      sessionId = rejectConcern(db, concernId).session_id;
    } else if (intent === "edit") {
      if (!coverage) {
        return { error: "Type the corrected coverage before saving an edit." };
      }
      sessionId = editConcern(db, { concernId, coverage }).revised.session_id;
    } else {
      throw new Error(`Unsupported concern review intent: ${intent}`);
    }
  } catch (error) {
    const message = domainErrorMessage(error);
    if (message) {
      return { error: message };
    }
    throw error;
  }

  revalidatePath(`/sessions/${sessionId}`);
  return { error: null };
}

export async function requestCoachingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const questionId = String(formData.get("questionId") ?? "");

  let sessionId: string;
  try {
    ({ sessionId } = requestCoaching(getAppDb(), {
      questionId,
      client: resolveModelClient(),
    }));
  } catch (error) {
    const message = domainErrorMessage(error);
    if (message) {
      return { error: message };
    }
    throw error;
  }

  revalidatePath(`/sessions/${sessionId}`);
  return { error: null };
}

export async function promoteCoachNoteAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const coachNoteId = String(formData.get("coachNoteId") ?? "");

  let sessionId: string;
  try {
    sessionId = promoteCoachNote(getAppDb(), coachNoteId).statement.session_id;
  } catch (error) {
    const message = domainErrorMessage(error);
    if (message) {
      return { error: message };
    }
    throw error;
  }

  revalidatePath(`/sessions/${sessionId}`);
  return { error: null };
}

export async function resolveQuestionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const questionId = String(formData.get("questionId") ?? "");
  const disposition = String(formData.get("disposition") ?? "");
  const body = String(formData.get("body") ?? "");

  if (disposition === "answered" && body.trim().length === 0) {
    return {
      error:
        "Type an answer before recording it, or mark the question unknown or deferred.",
    };
  }

  let sessionId: string;
  try {
    const resolved = resolveQuestion(getAppDb(), {
      questionId,
      disposition,
      body,
    });
    sessionId = resolved.question.session_id;
  } catch (error) {
    const message = domainErrorMessage(error);
    if (message) {
      return { error: message };
    }
    throw error;
  }

  revalidatePath(`/sessions/${sessionId}`);
  return { error: null };
}
