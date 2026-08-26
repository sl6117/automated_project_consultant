"use client";

import { useActionState } from "react";
import { createConsultationAction, type ActionState } from "@/app/actions";

const initialState: ActionState = { error: null };

export function StartForm() {
  const [state, formAction, isPending] = useActionState(
    createConsultationAction,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Project name
        <input
          name="name"
          required
          className="rounded border border-zinc-300 px-3 py-2 font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Rough idea
        <textarea
          name="idea"
          required
          rows={6}
          className="rounded border border-zinc-300 px-3 py-2 font-normal"
        />
      </label>
      {state.error ? (
        <p role="alert" className="text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Start consultation
      </button>
    </form>
  );
}
