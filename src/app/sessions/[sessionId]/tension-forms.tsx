"use client";

import { useActionState } from "react";
import {
  dismissTensionAction,
  tensionStatementAction,
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

export function DismissTensionForm({
  contradictionId,
}: {
  contradictionId: string;
}) {
  const [state, formAction, isPending] = useActionState(
    dismissTensionAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="contradictionId" value={contradictionId} />
      <ActionError error={state.error} />
      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50"
      >
        Dismiss tension
      </button>
    </form>
  );
}

export function TensionStatementForm({
  statementId,
  body,
}: {
  statementId: string;
  body: string;
}) {
  const [state, formAction, isPending] = useActionState(
    tensionStatementAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="statementId" value={statementId} />
      <textarea
        name="body"
        defaultValue={body}
        rows={2}
        aria-label="Revised statement"
        className="rounded border border-zinc-300 px-3 py-2 text-sm"
      />
      <ActionError error={state.error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="intent"
          value="revise"
          disabled={isPending}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Save revision
        </button>
        <button
          type="submit"
          name="intent"
          value="retract"
          disabled={isPending}
          className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-800 disabled:opacity-50"
        >
          Retract statement
        </button>
      </div>
    </form>
  );
}
