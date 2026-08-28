import { getAppDb } from "@/server/db/app-db";
import { getSessionDetail } from "@/server/ledger/sessions";
import { notFound } from "next/navigation";
import { AskQuestionForm } from "./ask-question-form";
import { CoachPromoteForm, CoachRequestForm } from "./coach-panel";
import { GenerateExportForm } from "./exports-panel";
import { MICROCENTS_PER_CENT } from "@/server/model/config";
import { CORE_CODES, ONTOLOGY_ORDER } from "@/server/model/rubric";
import { ConfirmFramingForm } from "./framing-form";
import { RetryConsultationForm } from "./retry-form";
import { DismissTensionForm, TensionStatementForm } from "./tension-forms";

function dollars(microcents: number): string {
  return `$${(microcents / (100 * MICROCENTS_PER_CENT)).toFixed(4)}`;
}
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
          A recorded fixture is used only in tests. Live mode calls Anthropic
          from this machine&apos;s server process only.
        </p>
        <p className="mt-2 text-sm text-zinc-700">
          Model spend: {dollars(detail.spend.settledActualMicrocents)} used
          {detail.spend.reservedEstimateMicrocents > 0
            ? ` + ${dollars(detail.spend.reservedEstimateMicrocents)} reserved`
            : ""}{" "}
          of {dollars(detail.spend.capMicrocents)} cap
        </p>
      </div>

      {detail.initializationStatus !== "active" ? (
        <section className="rounded border border-red-300 bg-red-50 p-4">
          <h2 className="text-lg font-medium text-red-900">
            Session start incomplete
          </h2>
          <p className="mt-1 text-sm text-red-900">
            The consultation did not finish starting: a model call failed or
            its output was rejected. Any model spend is recorded above.
            Retrying reuses this session and its budget cap — it never opens a
            fresh cap.
          </p>
          <RetryConsultationForm sessionId={detail.sessionId} />
        </section>
      ) : null}

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
        <h2 className="text-lg font-medium">Concern coverage checklist</h2>
        <p className="mt-1 text-sm text-zinc-600">
          The four core codes block &quot;first slice is framed&quot; while
          they have no approved coverage. Absence in the ledger is the gap.
        </p>
        <ul className="mt-3 grid grid-cols-2 gap-1 text-sm">
          {ONTOLOGY_ORDER.map((code) => {
            const covered = detail.approvedConcerns.some(
              (concern) => concern.code === code,
            );
            const core = CORE_CODES.includes(code);
            return (
              <li key={code} className={covered ? "text-zinc-700" : "text-zinc-500"}>
                {covered ? "✓" : "✗"} {code}
                {core && !covered ? (
                  <span className="ml-1 text-xs font-medium text-red-800">
                    blocking
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
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
        <h2 className="text-lg font-medium">Open tensions</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Possible conflicts Fable surfaced between approved statements. They
          never edit the ledger: dismiss a false alarm, or retract or revise a
          cited statement — which resolves every tension citing it.
        </p>
        {detail.openTensions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            No open tensions.
            {detail.closedTensionCount > 0
              ? ` ${detail.closedTensionCount} closed tension${
                  detail.closedTensionCount === 1 ? "" : "s"
                } kept as provenance.`
              : ""}
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {detail.openTensions.map((tension) => (
              <li
                key={tension.id}
                className="rounded border border-amber-300 bg-amber-50 p-4"
              >
                <p className="text-sm font-medium text-amber-950">
                  {tension.summary}
                </p>
                <ul className="mt-3 flex flex-col gap-3">
                  {tension.citedStatements.map((statement) => (
                    <li key={statement.id} className="text-sm text-zinc-700">
                      <p className="text-xs uppercase tracking-wide text-zinc-500">
                        Cited statement
                      </p>
                      <TensionStatementForm
                        statementId={statement.id}
                        body={statement.body}
                      />
                    </li>
                  ))}
                </ul>
                <DismissTensionForm contradictionId={tension.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-medium">Next question</h2>
        {!detail.pendingQuestion && detail.initializationStatus === "active" ? (
          detail.proposedStatements.length > 0 ||
          detail.proposedConcerns.length > 0 ? (
            <p className="mt-3 text-sm text-zinc-500">
              Review every proposed statement and concern above to unlock the
              next question. It is chosen from your approved ledger state.
            </p>
          ) : (
            <AskQuestionForm sessionId={detail.sessionId} />
          )
        ) : null}
        {detail.pendingQuestion ? (
          <div className="mt-3 rounded border border-zinc-200 p-4">
            <p>{detail.pendingQuestion.body}</p>
            <p className="mt-3 text-sm text-zinc-600">
              <span className="font-medium text-zinc-800">Why this question: </span>
              {detail.pendingQuestion.why_selected}
            </p>
            <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">
              Question provenance: {detail.pendingQuestion.provenance_source}
            </p>
            <QuestionResolveForm questionId={detail.pendingQuestion.id} />
          </div>
        ) : null}

        {detail.pendingQuestion && detail.pendingCandidates.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-sm font-medium">
              Candidate ranking (claimed vs effective)
            </h3>
            <p className="mt-1 text-sm text-zinc-600">
              Fable proposed these candidates with claimed scores; the rubric
              recomputed core-gap and contradiction scores from the ledger and
              asked its winner.
              {detail.pendingCandidates.some(
                (candidate) => candidate.model_rank !== candidate.rubric_rank,
              )
                ? " The rubric disagreed with the model's order."
                : ""}
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-zinc-500">
                    <th className="pr-2 font-medium">Candidate</th>
                    <th className="pr-2 font-medium">Concerns</th>
                    <th className="pr-2 font-medium">Claimed g/s/c</th>
                    <th className="pr-2 font-medium">Effective g/s/c</th>
                    <th className="pr-2 font-medium">Total</th>
                    <th className="pr-2 font-medium">Model rank</th>
                    <th className="pr-2 font-medium">Rubric rank</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.pendingCandidates.map((candidate) => (
                    <tr
                      key={candidate.id}
                      className={
                        candidate.selected
                          ? "font-medium text-zinc-900"
                          : "text-zinc-600"
                      }
                    >
                      <td className="pr-2">
                        {candidate.selected ? "▶ " : ""}
                        {candidate.body}
                      </td>
                      <td className="pr-2">
                        {(JSON.parse(candidate.concern_codes) as string[]).join(
                          ", ",
                        )}
                      </td>
                      <td className="pr-2">
                        {candidate.claimed_core_gap}/
                        {candidate.claimed_slice_bounding}/
                        {candidate.claimed_contradiction}
                      </td>
                      <td className="pr-2">
                        {candidate.effective_core_gap}/
                        {candidate.effective_slice_bounding}/
                        {candidate.effective_contradiction}
                      </td>
                      <td className="pr-2">{candidate.effective_total}</td>
                      <td className="pr-2">#{candidate.model_rank}</td>
                      <td className="pr-2">#{candidate.rubric_rank}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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

      <section>
        <h2 className="text-lg font-medium">First slice framing</h2>
        <p className="mt-1 text-sm text-zinc-600">
          A deterministic five-item checklist computed from the ledger decides
          when framing can be confirmed. Fable&apos;s readiness advice never
          satisfies an item; only your confirmation frames the slice, and
          confirming does not stop the consultation.
        </p>
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {detail.stopChecklist.items.map((item) => (
            <li
              key={item.key}
              className={item.pass ? "text-zinc-700" : "text-zinc-500"}
            >
              {item.pass ? "✓" : "✗"} {item.label}
              <span className="ml-1 text-xs text-zinc-500">
                — {item.evidence}
              </span>
            </li>
          ))}
        </ul>
        {detail.framedAt ? (
          <p className="mt-3 text-sm font-medium text-zinc-800">
            First slice framed at {detail.framedAt}.
          </p>
        ) : null}
        {detail.framedAt && !detail.stopChecklist.passes ? (
          <p
            role="status"
            className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          >
            The framing may be stale: the checklist no longer passes. The
            failing items above list the current gaps.
          </p>
        ) : null}
        {!detail.framedAt && detail.stopChecklist.passes ? (
          <ConfirmFramingForm sessionId={detail.sessionId} />
        ) : null}
        {!detail.framedAt && !detail.stopChecklist.passes ? (
          <p className="mt-3 text-sm text-zinc-500">
            The ready offer appears when every item passes.
          </p>
        ) : null}
      </section>

      <section>
        <h2 className="text-lg font-medium">Coach</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Optional advice about the current decision. Coaching stays out of
          exported specifications unless you promote a note, which records it
          as your own approved decision.
        </p>

        {detail.pendingQuestion ? (
          <CoachRequestForm questionId={detail.pendingQuestion.id} />
        ) : detail.coachNotes.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Coaching is available while a question is pending.
          </p>
        ) : null}

        {detail.coachNotes.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {detail.coachNotes.map((note) => (
              <li key={note.id} className="rounded border border-zinc-200 p-4">
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  Confidence: {note.confidence}
                  {note.promoted ? " · Promoted" : ""}
                </p>
                <p className="mt-2 font-medium">{note.recommendation}</p>
                <dl className="mt-3 flex flex-col gap-2 text-sm text-zinc-700">
                  <div>
                    <dt className="font-medium text-zinc-800">Why now</dt>
                    <dd>{note.why_now}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-zinc-800">Technique</dt>
                    <dd>{note.technique}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-zinc-800">Tradeoffs</dt>
                    <dd>{note.tradeoffs}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-zinc-800">Gotcha</dt>
                    <dd>{note.gotcha}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-zinc-800">
                      Evidence that would change this
                    </dt>
                    <dd>{note.evidence_would_change}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">
                  Provenance: {note.provenance_source}
                </p>
                {note.promoted ? null : (
                  <CoachPromoteForm coachNoteId={note.id} />
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h2 className="text-lg font-medium">Exports</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Markdown projections compiled from approved ledger state only.
          Proposals and unpromoted coaching are never included. Each generation
          is an immutable snapshot.
        </p>
        <GenerateExportForm sessionId={detail.sessionId} />

        {detail.artifactSets.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {detail.artifactSets.map((set, index) => (
              <li
                key={set.artifactSetId}
                className="rounded border border-zinc-200 p-4 text-sm"
              >
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  Export {detail.artifactSets.length - index} ·{" "}
                  {set.createdAt}
                </p>
                <ul className="mt-2 flex flex-wrap gap-3">
                  {set.files.map((file) => (
                    <li key={file.id}>
                      <a
                        href={`/sessions/${detail.sessionId}/artifacts/${file.id}`}
                        className="underline"
                      >
                        {file.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
