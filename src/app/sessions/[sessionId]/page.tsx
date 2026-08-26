import { getAppDb } from "@/server/db/app-db";
import { getSessionDetail } from "@/server/ledger/sessions";
import { notFound } from "next/navigation";
import {
  ConcernReviewForm,
  QuestionResolveForm,
  StatementReviewForm,
} from "./review-forms";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  let detail;

  try {
    detail = getSessionDetail(getAppDb(), sessionId);
  } catch {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-12">
      <p
        role="status"
        className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      >
        Local storage does not mean local inference. Consultation text sent to a
        model leaves this machine.
      </p>
      <div>
        <p className="text-sm text-zinc-500">Consultation</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {detail.projectName}
        </h1>
        {detail.idea ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
            {detail.idea}
          </p>
        ) : null}
        <p className="mt-3 text-sm text-zinc-600">
          Offline extraction is a restatement of your idea, not a live model.
          A recorded fixture is used only in tests. The next question is a Fable
          restatement until a live model is wired.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-medium">Proposed statements</h2>
        <p className="mt-1 text-sm text-zinc-600">
          These are not ledger facts until you approve them. Editing rejects the
          model&apos;s wording and approves yours, with a link back to the
          original.
        </p>
        {detail.proposedStatements.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No pending proposals.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {detail.proposedStatements.map((statement) => (
              <li
                key={statement.id}
                className="rounded border border-zinc-200 p-4"
              >
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  {statement.kind}
                </p>
                <StatementReviewForm
                  statementId={statement.id}
                  body={statement.body}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium">Proposed concern coverage</h2>
        <p className="mt-1 text-sm text-zinc-600">
          What the extraction claims each concern covers. Approve, correct, or
          reject each claim.
        </p>
        {detail.proposedConcerns.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No pending concerns.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {detail.proposedConcerns.map((concern) => (
              <li key={concern.id} className="rounded border border-zinc-200 p-4">
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  {concern.code}
                </p>
                <ConcernReviewForm
                  concernId={concern.id}
                  coverage={concern.coverage}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium">Approved ledger statements</h2>
        {detail.approvedStatements.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nothing approved yet. Exports will not include proposals.
          </p>
        ) : (
          <ul className="mt-3 list-disc pl-5">
            {detail.approvedStatements.map((statement) => (
              <li key={statement.id}>
                <span className="text-xs uppercase tracking-wide text-zinc-500">
                  {statement.kind}
                </span>
                {": "}
                {statement.body}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium">Approved concern coverage</h2>
        {detail.approvedConcerns.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            No concern coverage approved yet.
          </p>
        ) : (
          <ul className="mt-3 list-disc pl-5">
            {detail.approvedConcerns.map((concern) => (
              <li key={concern.id}>
                <span className="text-xs uppercase tracking-wide text-zinc-500">
                  {concern.code}
                </span>
                {": "}
                {concern.coverage}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium">Next question</h2>
        {detail.pendingQuestion ? (
          <div className="mt-3 rounded border border-zinc-200 p-4">
            <p>{detail.pendingQuestion.body}</p>
            <p className="mt-3 text-sm text-zinc-600">
              <span className="font-medium text-zinc-800">Why this question: </span>
              {detail.pendingQuestion.why_selected}
            </p>
            <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">
              Provenance: {detail.pendingQuestion.provenance_source}
            </p>
            <QuestionResolveForm questionId={detail.pendingQuestion.id} />
          </div>
        ) : detail.resolvedQuestions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            No pending question.
          </p>
        ) : null}

        {detail.resolvedQuestions.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {detail.resolvedQuestions.map((question) => (
              <li
                key={question.id}
                className="rounded border border-zinc-100 p-4 text-sm"
              >
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  {question.answer?.disposition ?? question.status}
                </p>
                <p className="mt-1 font-medium">{question.body}</p>
                {question.answer ? (
                  <p className="mt-2 text-zinc-700">{question.answer.body}</p>
                ) : null}
                <p className="mt-2 text-xs text-zinc-500">
                  Answer provenance: {question.answer?.provenance_source ?? "none"}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
