"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAppDb } from "@/server/db/app-db";
import { compileArtifacts } from "@/server/artifacts/compiler";
import {
  ExportNotReadyError,
  recordArtifactSet,
} from "@/server/ledger/artifact-versions";
import { promoteCoachNote } from "@/server/ledger/coach-notes";
import {
  approveConcern,
  editConcern,
  rejectConcern,
} from "@/server/ledger/concerns";
import {
  dismissContradiction,
  retractCitedStatement,
  reviseCitedStatement,
} from "@/server/ledger/contradictions";
import { CostCapError } from "@/server/ledger/cost";
import {
  FramingNotReadyError,
  confirmFraming,
} from "@/server/ledger/framing";
import { ModelTransportError } from "@/server/model/attempt-runner";
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
  retryStartSession,
  type SessionStartResult,
} from "@/server/model/extract";
import {
  IncrementalExtractionValidationError,
  proposeFromAnswer,
} from "@/server/model/incremental";
import { resolveModelClient } from "@/server/model/mode";
import {
  ConsultationNotReadyError,
  NextQuestionValidationError,
  StaleConsultationError,
  askAdaptiveQuestion,
} from "@/server/model/next-question";

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
  if (error instanceof ConsultationNotReadyError) {
    return "Review every proposed statement and concern, and resolve the pending question, before asking the next one.";
  }
  if (error instanceof ModelTransportError) {
    return "The model call could not complete. Recorded spend was kept; nothing else was saved. Retry when ready.";
  }
  if (error instanceof FramingNotReadyError) {
    return "The stop checklist no longer passes, so framing cannot be confirmed. Resolve the listed gaps first.";
  }
  if (error instanceof StaleConsultationError) {
    return "The consultation changed while the model call was running, so nothing from that call was saved. The spend was recorded; ask again from the current state.";
  }
  if (error instanceof ExportNotReadyError) {
    return "Approve at least one statement before generating an export.";
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

  // Domain failures (validation, transport, cost cap) come back as a
  // 'failed' session, not an exception: the session page renders that state
  // with recorded spend and a retry that reuses the same session and cap.
  const { sessionId } = await extractAndStartSession(getAppDb(), {
    projectName: name,
    idea,
    client: resolveModelClient(),
  });

  redirect(`/sessions/${sessionId}`);
}

function startFailureMessage(
  failure: SessionStartResult["failure"],
): string | null {
  if (failure === "cost-cap") {
    return "This would exceed the session model budget cap. Tick the over-cap confirmation to proceed anyway.";
  }
  if (failure === "transport") {
    return "The model call could not complete. Recorded spend was kept; nothing else was saved. Retry when ready.";
  }
  if (failure) {
    return "The model returned output that failed validation. The spend was recorded; nothing else was saved.";
  }
  return null;
}

export async function retryConsultationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requestedSessionId = String(formData.get("sessionId") ?? "");
  const confirmedOverCap = formData.get("confirmedOverCap") === "on";

  let result: SessionStartResult;
  try {
    result = await retryStartSession(getAppDb(), {
      sessionId: requestedSessionId,
      client: resolveModelClient(),
      confirmedOverCap,
    });
  } catch (error) {
    const message = domainErrorMessage(error);
    if (message) {
      return { error: message };
    }
    throw error;
  }

  revalidatePath(`/sessions/${result.sessionId}`);
  return { error: startFailureMessage(result.failure) };
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
  const confirmedOverCap = formData.get("confirmedOverCap") === "on";

  let sessionId: string;
  try {
    ({ sessionId } = await requestCoaching(getAppDb(), {
      questionId,
      client: resolveModelClient(),
      confirmedOverCap,
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

export async function generateArtifactsAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requestedSessionId = String(formData.get("sessionId") ?? "");

  const db = getAppDb();
  let sessionId: string;
  try {
    const files = compileArtifacts(db, requestedSessionId);
    const rows = recordArtifactSet(db, {
      sessionId: requestedSessionId,
      files,
    });
    sessionId = rows[0].session_id;
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

export async function askQuestionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requestedSessionId = String(formData.get("sessionId") ?? "");
  const confirmedOverCap = formData.get("confirmedOverCap") === "on";

  try {
    // A null question is not an error: the stop checklist passed after this
    // payload's contradictions persisted, so the page shows the ready offer
    // instead of a new pending question.
    await askAdaptiveQuestion(getAppDb(), {
      sessionId: requestedSessionId,
      client: resolveModelClient(),
      confirmedOverCap,
    });
  } catch (error) {
    const message = domainErrorMessage(error);
    if (message) {
      return { error: message };
    }
    throw error;
  }

  revalidatePath(`/sessions/${requestedSessionId}`);
  return { error: null };
}

export async function dismissTensionAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const contradictionId = String(formData.get("contradictionId") ?? "");

  let sessionId: string;
  try {
    sessionId = dismissContradiction(getAppDb(), contradictionId).session_id;
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

export async function tensionStatementAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const statementId = String(formData.get("statementId") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  const db = getAppDb();
  let sessionId: string;
  try {
    if (intent === "retract") {
      sessionId = retractCitedStatement(db, statementId).statement.session_id;
    } else if (intent === "revise") {
      if (!body) {
        return { error: "Type the revised statement before saving it." };
      }
      sessionId = reviseCitedStatement(db, { statementId, body }).revised
        .session_id;
    } else {
      throw new Error(`Unsupported tension statement intent: ${intent}`);
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

export async function confirmFramingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requestedSessionId = String(formData.get("sessionId") ?? "");

  let sessionId: string;
  try {
    ({ sessionId } = confirmFraming(getAppDb(), requestedSessionId));
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

  const db = getAppDb();
  let sessionId: string;
  try {
    const resolved = resolveQuestion(db, {
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

  // The answer is stored; the incremental Sonnet pass runs afterward and its
  // failure never un-records the answer.
  try {
    await proposeFromAnswer(db, {
      questionId,
      client: resolveModelClient(),
      confirmedOverCap: formData.get("confirmedOverCap") === "on",
    });
  } catch (error) {
    revalidatePath(`/sessions/${sessionId}`);
    if (error instanceof IncrementalExtractionValidationError) {
      return {
        error:
          "Your answer was recorded, but the model's follow-up proposals failed validation and were discarded.",
      };
    }
    const message = domainErrorMessage(error);
    if (message) {
      return {
        error: `Your answer was recorded. Follow-up proposals did not: ${message}`,
      };
    }
    throw error;
  }

  revalidatePath(`/sessions/${sessionId}`);
  return { error: null };
}
