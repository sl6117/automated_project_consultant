"use client";

import { useActionState } from "react";
import {
  promoteCoachNoteAction,
  requestCoachingAction,
  type ActionState,
} from "@/app/actions";

const initialState: ActionState = { error: null };

function ActionError({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }
  return (
    <p role="alert" className="text-sm text-red-800">
      {error}
    </p>
  );
}

export function CoachRequestForm({ questionId }: { questionId: string }) {
  const [state, formAction, isPending] = useActionState(
    requestCoachingAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="questionId" value={questionId} />
      <ActionError error={state.error} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirmedOverCap" />
        Confirm spending over the session cap
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50"
      >
        Get coaching
      </button>
    </form>
  );
}

export function CoachPromoteForm({ coachNoteId }: { coachNoteId: string }) {
  const [state, formAction, isPending] = useActionState(
    promoteCoachNoteAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="coachNoteId" value={coachNoteId} />
      <ActionError error={state.error} />
      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Promote to decision
      </button>
    </form>
  );
}
