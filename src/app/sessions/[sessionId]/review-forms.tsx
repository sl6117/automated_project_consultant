"use client";

import { useActionState } from "react";
import {
  resolveQuestionAction,
  reviewConcernAction,
  reviewStatementAction,
  type ActionState,
} from "@/app/actions";

const initialState: ActionState = { error: null };

const buttonClasses = {
  approve:
    "rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50",
  edit: "rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50",
  reject:
    "rounded border border-red-300 px-3 py-1.5 text-sm text-red-800 disabled:opacity-50",
};

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

export function StatementReviewForm({
  statementId,
  body,
}: {
  statementId: string;
  body: string;
}) {
  const [state, formAction, isPending] = useActionState(
    reviewStatementAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-3">
      <input type="hidden" name="statementId" value={statementId} />
      <textarea
        name="body"
        defaultValue={body}
        rows={2}
        aria-label="Statement text"
        className="rounded border border-zinc-300 px-3 py-2 text-sm"
      />
      <ActionError error={state.error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="intent"
          value="approve"
          disabled={isPending}
          className={buttonClasses.approve}
        >
          Approve
        </button>
        <button
          type="submit"
          name="intent"
          value="edit"
          disabled={isPending}
          className={buttonClasses.edit}
        >
          Save edit
        </button>
        <button
          type="submit"
          name="intent"
          value="reject"
          disabled={isPending}
          className={buttonClasses.reject}
        >
          Reject
        </button>
      </div>
    </form>
  );
}

export function ConcernReviewForm({
  concernId,
  coverage,
}: {
  concernId: string;
  coverage: string;
}) {
  const [state, formAction, isPending] = useActionState(
    reviewConcernAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-3">
      <input type="hidden" name="concernId" value={concernId} />
      <textarea
        name="coverage"
        defaultValue={coverage}
        rows={2}
        aria-label="Concern coverage"
        className="rounded border border-zinc-300 px-3 py-2 text-sm"
      />
      <ActionError error={state.error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="intent"
          value="approve"
          disabled={isPending}
          className={buttonClasses.approve}
        >
          Approve concern
        </button>
        <button
          type="submit"
          name="intent"
          value="edit"
          disabled={isPending}
          className={buttonClasses.edit}
        >
          Save concern edit
        </button>
        <button
          type="submit"
          name="intent"
          value="reject"
          disabled={isPending}
          className={buttonClasses.reject}
        >
          Reject concern
        </button>
      </div>
    </form>
  );
}

export function QuestionResolveForm({ questionId }: { questionId: string }) {
  const [state, formAction, isPending] = useActionState(
    resolveQuestionAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="questionId" value={questionId} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Answer
        <textarea
          name="body"
          rows={4}
          required
          className="rounded border border-zinc-300 px-3 py-2 font-normal"
        />
      </label>
      <ActionError error={state.error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="disposition"
          value="answered"
          disabled={isPending}
          className={buttonClasses.approve}
        >
          Record answer
        </button>
        <button
          type="submit"
          name="disposition"
          value="unknown"
          formNoValidate
          disabled={isPending}
          className={buttonClasses.edit}
        >
          Mark unknown
        </button>
        <button
          type="submit"
          name="disposition"
          value="deferred"
          formNoValidate
          disabled={isPending}
          className={buttonClasses.edit}
        >
          Mark deferred
        </button>
      </div>
    </form>
  );
}
