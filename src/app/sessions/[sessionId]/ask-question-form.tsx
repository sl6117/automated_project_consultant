"use client";

import { useActionState } from "react";
import { askQuestionAction, type ActionState } from "@/app/actions";

const initialState: ActionState = { error: null };

export function AskQuestionForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, isPending] = useActionState(
    askQuestionAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      {state.error ? (
        <p role="alert" className="text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="confirmedOverCap" />
        Confirm spending over the session cap
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Ask next question
      </button>
    </form>
  );
}
