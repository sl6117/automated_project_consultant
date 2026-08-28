"use client";

import { useActionState } from "react";
import { confirmFramingAction, type ActionState } from "@/app/actions";

const initialState: ActionState = { error: null };

export function ConfirmFramingForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, isPending] = useActionState(
    confirmFramingAction,
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
      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        Confirm first slice is framed
      </button>
    </form>
  );
}
