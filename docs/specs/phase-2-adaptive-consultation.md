# Phase 2 — Adaptive consultation

Status: complete (2026-08-27). All four slices (canonical context and
deferred first question, incremental extraction after answers, coverage +
candidates + visible rubric, contradictions and deterministic stop) are
implemented under guided-driver mode and reviewed against this spec with all
accepted findings applied. Offline verification is green (typecheck, lint,
163 unit tests); the owner's external build and browser gate runs before the
phase commit. Two owner-ratified interpretations: `readyAdvice` is validated
but deliberately not persisted or rendered in Phase 2, and the
skip-question-on-passing-checklist rule applies only before `framed_at` is
set, so confirming never locks further questions.

Working mode: guided-driver. Each slice holds one learning checkpoint at its
primary AI boundary; mechanical UI, SQL, wiring, and tests may then be
implemented within this spec. Owner-managed files stay locked.

## Locked decisions (2026-08-26)

1. **Coverage:** `problem`, `user`, `workflow`, and `success` are blocking if
   they have no approved coverage. The other six ontology codes are optional
   until they become relevant. Ledger absence is the gap. Thin-versus-sufficient
   is advisory text only, never a canonical score.
2. **Contradictions:** Fable proposes cited tensions. The UI surfaces them. The
   user resolves them with the existing statement edit/reject path or dismisses
   a false positive. No auto-supersession.
3. **Ranking:** bounded hybrid. Fable generates candidates plus claimed scores.
   A deterministic rubric re-ranks and the app asks the rubric winner. Claimed
   versus effective scores and model versus rubric order stay visible.
4. **Scoring:** integers 0–3 on core-gap, slice-bounding, and contradiction
   resolution. Sum them. Ties break by concern-ontology order of the
   candidate's first concern code, then candidate index. Never random.
5. **Stopping:** offer “first slice is framed” only when the inspectable
   checklist passes. The user still confirms. Fable's ready flag is advisory
   and cannot show ready on its own.
6. **Answer promotion:** resolving a question stores the answer and does **not**
   auto-approve a statement. Sonnet proposes statement and concern updates from
   that answer; they stay proposed until the user approves, edits, or rejects
   them. This is an intentional change from Phase 1 `resolveQuestion`.

## Goal

Turn the Phase 1 one-shot consultation into an inspectable loop: the next
question is chosen from canonical ledger state, ranked by a visible rubric,
challenged by surfaced contradictions, and able to stop when a
minimum-sufficient first slice is framed.

This remains a **project-framing consultant**, not a complete-spec generator
and not a swarm.

## Non-goals

- Swarm, specialist delegation, runtime agents, shell access, or repository
  editing.
- Cheap-model routing or a third model alias.
- Making Fable's ready flag or ranked order authoritative.
- Auto-superseding approved statements.
- Treating all ten concern codes as required.
- The Phase 3 10–15-brief evaluation program, pairwise evals, or calibration.
- Brownfield repository import (Phase 6).
- Live Anthropic calls from Vitest, Playwright, or CI.
- New npm dependencies.
- Editing owner-managed files.
- Changing the coach payload contract except as required to keep the shared
  Fable envelope valid.

## Invariants this phase must honor

All Phase 1 invariants remain, plus:

- Approved ledger state is the input to ranking, contradiction checks, and
  stopping. The raw idea is supporting context, not the source of truth.
- Invalid model output is rejected wholesale and not partially applied.
- Humans own decisions. Models propose candidates, scores, tensions, and
  ready advice. Application code ranks and gates. Only explicit user action
  approves statements, dismisses contradictions, or confirms framing.
- The cached system prefix stays policy, ontology, contracts, and coaching
  rules. Session IDs, approved rows, scores, and gaps belong in the dynamic
  suffix. Putting ledger state in the prefix is a spec violation.
- Tests and CI stay offline. Live calls remain owner-initiated and under the
  existing $5 session cap with explicit over-cap confirmation.
- Phase 1 sessions remain readable. Migrations are additive. Existing
  auto-approved answer-statements stay valid; new resolves follow the Phase 2
  promotion rule.

## User-visible flow

1. Banner and project creation stay as in Phase 1.
2. Starting a session runs **Sonnet extraction only**. The session becomes
   `active` after a valid extraction is committed. There is no Fable question
   at start.
3. The user approves, edits, or rejects each proposed statement and concern.
4. When no proposals and no pending question remain, the app runs the adaptive
   Fable call (candidates, claimed scores, contradictions, advisory readiness).
5. The UI shows the candidate list with claimed scores, effective scores, model
   rank, and rubric rank. If the rubric disagrees with Fable, that disagreement
   is visible. The pending question is the rubric winner.
6. The user answers, or marks the question unknown or deferred. The answer is
   stored on the question. No statement is auto-approved.
7. Sonnet proposes incremental statements and concern updates from that answer.
   The same review UI handles them. Duplicate restatements of already-approved
   bodies may be rejected by the user; the app does not auto-dedupe by fuzzy
   match.
8. Open contradictions appear as tensions, not as ledger edits. The user
   dismisses a false positive or edits/rejects a cited statement. Editing a
   cited approved statement marks contradictions that cited it resolved.
9. After review is clear, the stop checklist is evaluated using the latest
   Fable contradiction pass. If it passes, the UI offers “first slice is
   framed” with the checklist evidence. The user may confirm or continue.
10. Confirming writes `framed_at` and does not lock the session. The user may
    keep asking questions. Exports remain available whenever at least one
    approved statement exists, as in Phase 1.
11. Coach stays optional, separate from exports, and still requires promotion.

Coverage UI: a ten-code checklist that marks each code approved or missing,
and marks the four core codes as blocking when missing.

## Canonical data (ledger)

Additive migration (next number after `007_live_model_attempts.sql`). Do not
rebuild Phase 1 tables.

### Coverage

No new concern-status enum. A core code is a **gap** when the session has no
approved concern row with that code. Proposed or rejected rows do not fill a
gap. Optional codes are never stop-blockers.

Core codes, in ontology order: `problem`, `user`, `workflow`, `success`.
Ontology order for the remaining codes: `data`, `safety`, `quality`,
`operations`, `constraints`, `non-goals`.

### `question_candidates`

Persist every validated candidate from an adaptive Fable call, including the
ones not asked:

- `id`, `session_id`, `model_call_id`
- `body`, `model_why_selected`
- `concern_codes` (JSON array of ontology codes, at least one)
- `claimed_core_gap`, `claimed_slice_bounding`, `claimed_contradiction` (0–3)
- `effective_core_gap`, `effective_slice_bounding`,
  `effective_contradiction`, `effective_total`
- `model_rank` (1-based order as returned)
- `rubric_rank` (1-based after the rubric)
- `selected` (true only for the candidate inserted as the pending question)
- `created_at`

The pending `questions.why_selected` text is the **rubric** explanation
(effective scores, overrides, tie-break), not Fable's prose alone. Fable's
prose stays on the candidate row.

### `contradictions`

- `id`, `session_id`, `model_call_id`
- `summary`
- `cited_statement_ids` (JSON array; every id must be an approved statement
  in the prompt's ledger slice)
- `status`: `open` | `dismissed` | `resolved`
- `created_at`, `closed_at` nullable

A new Fable pass does not silently delete open rows that still apply; it may
add new ones. Dismissed and resolved rows stay as provenance.

### `discovery_sessions.framed_at`

Nullable timestamp. Set only when the user confirms the ready offer. Do not
clear it if the checklist later fails; show that framing may be stale and
list the current gaps.

## Model boundaries

Configuration, attempt receipts, integer-microcent accounting, and the $5 cap
stay as in Phase 1. No new model alias.

### Cached prefix and Fable envelope

The shared Fable envelope remains `{ task, payload }` so next-question and
coach keep one `output_config` and one cache key. Phase 2 expands the
`next_question` payload and therefore **busts the prompt cache once**. Do not
add a third Fable task in this phase.

Coach payload shape is unchanged. A valid coach payload under `next_question`,
or a valid adaptive payload under `coach`, is still rejected.

### Sonnet — initial extraction

Unchanged contract (`statements` min 1). Called only at session start.

### Sonnet — incremental extraction

New task, same model, distinct user message, **distinct Zod contract**: both
`statements` and `concerns` arrays may be empty. If both are empty, persist
nothing from that payload and continue to the adaptive Fable call.

User message includes: project name, idea, approved statements with ids,
approved concerns with ids, the resolved question, the answer body, and the
disposition.

Do not reuse `extractionOutputSchema`'s `statements.min(1)` for this path.

### Fable — adaptive next question

Replaces the Phase 1 `{ body, whySelected }` payload. Required shape:

```text
{
  "task": "next_question",
  "payload": {
    "candidates": [
      {
        "body": "<exactly one question>",
        "whySelected": "<model's reason>",
        "concernCodes": ["<one or more ontology codes>"],
        "claimedScores": {
          "coreGap": 0-3,
          "sliceBounding": 0-3,
          "contradictionResolution": 0-3
        },
        "targetsContradictionIndexes": [<indexes into payload.contradictions>]
      }
    ],
    "contradictions": [
      {
        "summary": "<the tension>",
        "citedStatementIds": ["<approved statement ids from the prompt>"]
      }
    ],
    "readyAdvice": {
      "ready": true|false,
      "why": "<advisory only>"
    }
  }
}
```

Constraints:

- `candidates` length 1–5. Each `body` is one question, not a bundle.
- `concernCodes` min 1, all valid ontology codes.
- Claimed scores are integers 0–3.
- `citedStatementIds` min 2, and every id must appear in the approved
  statements supplied in the prompt. Unknown ids invalidate the **whole**
  payload.
- `targetsContradictionIndexes` must be in range or the whole payload is
  invalid.
- Empty `contradictions` is valid.

User message includes approved statements and concerns **with ids**, missing
core codes, open contradiction ids/summaries, and resolved questions. It does
not include coach notes.

### Ranking rubric (application code)

Store claimed scores. Compute effective scores as follows:

1. **coreGap (deterministic):** 3 if any tagged concern code is a missing core
   code; 1 if none are missing core but at least one tagged code is a missing
   optional code; 0 if every tagged code already has approved coverage.
   Fable's claimed `coreGap` is stored for comparison and is **not** used in
   `effective_core_gap`.
2. **contradictionResolution (deterministic):** 3 if the candidate targets at
   least one **open** contradiction from this payload; 0 otherwise. Claimed
   `contradictionResolution` is stored and not used in the effective score.
3. **sliceBounding (model-claimed):** Fable's `claimedScores.sliceBounding`,
   clamped to 0–3. This is the only dimension the model can move.

`effective_total` = those three effective values.

Sort by `effective_total` descending, then by ontology order of the
candidate's first `concernCodes` entry, then by payload index. The first
candidate after that sort is the winner.

If the stop checklist will pass after this payload's contradictions are
persisted, **do not** insert a pending question even if candidates exist.

### Stop checklist (application code)

Offer ready only when all of the following are true. Show each item as pass or
fail in the UI:

1. Approved coverage exists for `problem`, `user`, `workflow`, and `success`.
2. No `open` contradiction rows.
3. At least one approved statement with kind `decision` or `fact`.
4. No pending question.
5. No proposed statements or concerns.

`readyAdvice.ready` may be shown as advice. It must not satisfy any checklist
item. If the checklist fails, the UI cannot offer confirm-ready.

Evaluate this checklist only after the latest adaptive Fable call has been
validated and its contradictions persisted (so item 2 is not skipped). If
items 1, 3, 4, and 5 already fail, the call still runs: it is how candidates
and new tensions are produced.

### Context selection

`describeNextQuestionRequest` and the incremental extraction description must
take the approved ledger slice (ids + bodies + concern codes), not only
`projectName` and `idea`. Coach already does this for bodies; Phase 2 adds ids
on the adaptive path because contradictions cite them.

## Implementation slices (do in order)

One guided-driver checkpoint per slice, then mechanical implementation.

1. **Canonical context and deferred first question**
   Primary boundary: prompt suffix versus cached prefix.
   Start runs extraction only. After proposals are cleared, the adaptive Fable
   path may run (Phase 1 payload still accepted only until slice 3 replaces
   it; if slice 1 ships first, keep the Phase 1 next-question payload but feed
   it ledger context, then replace the payload in slice 3). Prefer shipping
   slices 1 and 3 close together so the expanded payload does not land as a
   second cache bust.
   Tests: next-question user message contains approved ids and omits them
   from `buildSystemPrefix`; startConsultation does not insert a question.

2. **Incremental extraction after answers**
   Primary boundary: Sonnet incremental contract, including empty output.
   `resolveQuestion` stops auto-approving a statement. Incremental proposals
   use the existing review UI. Invalid JSON leaves the answer stored and
   adds no statements or concerns.
   Tests: answering does not create an approved statement; empty incremental
   payload persists nothing; malformed payload persists nothing; exports omit
   the answer until a proposal is approved.

3. **Coverage, candidates, and visible rubric**
   Primary boundary: claimed versus effective scores.
   Coverage checklist in the UI. Expanded Fable payload. Persist candidates.
   Rubric unit tests need no model. UI shows claimed, effective, model rank,
   rubric rank, and disagreement.
   Learning checkpoint: the owner ranks a synthetic candidate set and
   compares that order with the rubric.

4. **Contradictions and deterministic stop**
   Primary boundary: advisory ready versus checklist gate.
   Persist/dismiss/resolve contradictions. Ready offer with checklist
   evidence and confirm → `framed_at`. Fable `ready: true` with a missing
   core concern must not offer confirm.
   Tests: unknown cited ids reject the whole payload; dismiss unblocks stop;
   confirming does not lock further questions.

Do not start a slice until the previous slice's verification suite is green.

## Tests (offline)

New fixtures live under `tests/fixtures/phase-2/` and are synthetic only.

Minimum recorded set (four briefs, not the Phase 3 program):

- **A — core gap:** approved problem/success, missing user and workflow.
  Rubric must select the candidate tagged with a missing core code even if
  Fable ranked a non-core candidate first.
- **B — model/rubric disagreement on slice-bounding:** all core codes
  covered, no open contradictions. Winner is the highest claimed
  `sliceBounding`, with the documented tie-break.
- **C — contradiction:** two approved statements and an open tension.
  Candidate targeting that contradiction wins over a higher claimed
  slice-bounding candidate that does not target it.
- **D — stop:** core coverage present, an approved fact or decision, no open
  contradictions, no pending proposals. After the Fable call, no pending
  question is inserted; ready is offered. A variant with `readyAdvice.ready:
  true` and a missing core code must not offer ready.

Also:

- Unit: Zod reject/accept for the new payloads; rubric sort and tie-break;
  gap computation; stop checklist; incremental empty versus invalid;
  `resolveQuestion` no longer auto-approves.
- Contract: recorded Sonnet incremental and Fable adaptive fixtures parse
  and round-trip; wrong-task envelope still rejected.
- Browser: start a synthetic session, approve extraction, see a ranked
  question with visible scores, answer it, review incremental proposals,
  see a contradiction that can be dismissed, and see the ready offer only
  when the checklist passes. Recorded client only.

Phase 1 fixtures remain for extraction, coach, and regression of unchanged
paths. Replace Phase 1 next-question recorded payloads where the start flow
or schema no longer matches.

## Acceptance criteria

1. A synthetic idea can complete the adaptive loop (extract → review → ranked
   question → answer → incremental review → stop or next question) without a
   live API key.
2. Session start does not persist a next question before extraction review.
3. Answering a question does not auto-approve a statement.
4. Incremental Sonnet output is proposed only; empty valid output persists
   nothing; invalid output persists nothing beyond the already-stored answer.
5. The asked question is the rubric winner. When it differs from Fable's
   first candidate, both ranks are visible and both candidate rows persist.
6. Effective `coreGap` and `contradictionResolution` are computed from the
   ledger, not copied from claimed scores.
7. Open contradictions never edit statements. Dismiss or statement edit is
   the only close path.
8. Ready is offered only when the five-item checklist passes. Fable
   `readyAdvice` cannot override a failed item.
9. Confirming framing sets `framed_at` and does not prevent further
   questions or exports.
10. Prompt prefix bytes do not include session ledger state. Adaptive user
    messages include approved row ids.
11. Existing Phase 1 sessions load. New columns are nullable or defaulted.
12. `npm test`, `npm run test:browser`, `npm run typecheck`, `npm run lint`,
    and `npm run build` pass without Anthropic credentials.
13. No new runtime dependency. No cheaper-model routing. No swarm.
14. `test-writer` remains read-only.

## Owner-managed files

Do not edit `CLAUDE.md`, `.claude/settings.json`, hooks, or agents unless the
owner unlocks a named file. After implementation exists, the owner may add
the Phase 2 spec path and any new commands to `CLAUDE.md`.

## Approval

Approved by the owner on 2026-08-26. Claude Code may implement product code
within the current slice after that slice's guided-driver checkpoint. Do not
start slice N+1 until slice N's verification suite is green. Do not edit
owner-managed files unless the owner unlocks the named file.
