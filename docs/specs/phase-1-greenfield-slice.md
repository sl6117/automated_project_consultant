# Phase 1 — Greenfield consultant vertical slice

Status: approved. Slices 1–5 (ledger + Zod contracts, recorded extraction + approval UI, one-question loop, coach panel with promotion, ledger-only artifact compiler with immutable versioned downloads) are implemented and reviewed. `@anthropic-ai/sdk` waits for slice 6.

## Goal

Ship the smallest localhost path that turns a rough idea into a traceable, minimum-sufficient project seed:

1. Create a project from a rough idea in the local web UI.
2. Extract typed statements and concern coverage through structured model output.
3. Show exactly what the model inferred; require approval or correction before it becomes ledger state.
4. Ask one next question (Fable); record the answer and provenance; update the ledger.
5. Let the user mark a choice decided, unknown, or deferred.
6. Offer an optional coach panel for the current decision (stored separately from exportable specs).
7. Download versioned Markdown projections of the ledger.

This is a **project-framing consultant and decision coach**, not a complete-spec generator.

## Non-goals

- Swarm, specialist delegation, or runtime agents that mutate the ledger.
- Adaptive ranking of many candidate questions (Phase 2).
- Cheap-model routing after evals (Phase 2/3).
- Brownfield repository import (Phase 6).
- Writing files into other git repositories.
- Live Anthropic calls from Vitest, Playwright, or CI.
- Upgrading `test-writer` to `Write`/`Edit`.
- Cloud sync, accounts, or binding off localhost.

## Invariants this slice must honor

From `CLAUDE.md`:

- The SQLite ledger is canonical. Chat transcripts and Markdown downloads are projections.
- Humans approve or supersede decisions. Models recommend only.
- Every model boundary returns structured output; invalid output is rejected and not partially applied.
- Coaching is excluded from `SPEC.md`, `ROADMAP.md`, and export `AGENTS.md` unless the user promotes a specific item.
- Real consultations are gitignored. Tests use synthetic fixtures and recorded responses.
- Default budget cap is **$5 per discovery session**; exceeding it requires an explicit UI confirmation, not a silent retry.
- Model ids, prices, and effective dates live in versioned configuration, not call sites.
- The UI states that local storage does not mean local inference: prompts leave the machine.
- Never send secrets, credentials, private source code, or sensitive personal documents.

## User-visible flow

1. Banner: local DB ≠ local model; Anthropic receives consultation text.
2. User enters a project name and a rough idea; submits.
3. Sonnet extraction returns proposed statements and concern coverage. UI shows them as **proposed**, not saved facts.
4. User approves, edits, or rejects each proposal. Only then persist to the ledger.
5. Fable returns exactly one next question plus why it was selected (inspectable, not hidden).
6. User answers, or marks the underlying choice decided / unknown / deferred.
7. Optional coach panel for the current decision: recommendation, why now, technique, tradeoffs, gotcha, confidence, what evidence would change the advice.
8. User can download the current artifact set at any time after at least one approved statement exists.

## Canonical data (ledger)

Persist under `src/server/` with SQLite and numbered SQL migrations. Minimum tables for this slice:

- `projects`, `discovery_sessions` (include estimated cost cents and cap cents)
- `statements` with kind `fact | decision | hypothesis | unknown | deferred`
- `concerns` using the ontology: problem, user, workflow, data, safety, quality, operations, constraints, non-goals, success
- `questions`, `answers`, provenance links (source: user | model-inference; model call id when applicable)
- `coach_notes` (not compiled into SPEC/ROADMAP/export AGENTS unless promoted)
- `artifact_versions` (immutable snapshots of generated Markdown)
- `model_calls` (model alias, tokens, cache, latency, estimated cost, recorded vs live)

Do not let the UI or export path write statements except through ledger functions that validate Zod schemas.

## Model routing (this slice only)

Configuration module (e.g. `src/server/model/config.ts`) owns aliases and prices.

- **Sonnet:** structured extraction of statements and concerns; draft artifact Markdown from ledger state.
- **Fable:** the single next question, user-facing recommendation text, coach recommendation, and any “ready enough to export as a seed” judgement.
- Do not call a cheaper model in Phase 1.

Every live or recorded call:

1. Build messages from cached prefix (policy, ontology, schemas) plus ledger slice + recent turns.
2. Require structured output matching a Zod schema.
3. If validation fails: persist nothing from that payload; surface the error; do not retry unlimited times into the cost cap.

Tests inject a `ModelClient` with recorded JSON. Production uses the Anthropic SDK. No `fetch` to Anthropic from the browser.

## Artifacts (projections)

Generate from ledger only:

- `SPEC.md` — behavior and acceptance criteria from approved statements/requirements
- `ROADMAP.md` — first vertical slice and dependencies
- `AGENTS.md` — stable repo instructions derived from approved decisions only
- `DECISIONS.md`, `ASSUMPTIONS.md`, `OPEN_QUESTIONS.md`

Coach copy is omitted unless the user explicitly promotes a note. Downloads go to the browser (user-chosen save); the app must not write project files outside app storage (`data/` or similar, gitignored except migrations/schema).

## Privacy and layout

- Gitignore `data/` (or equivalent) for live SQLite and raw model payloads.
- Commit `tests/fixtures/phase-1/**` synthetic ideas, expected extractions, and recorded model JSON (no real consultations).
- Product paths to add when they exist: `src/server/`, `src/app/` routes for the consultant UI, `data/` gitignored.

## Implementation slices (do in order)

1. **Ledger + Zod contracts** — migrations, statement/concern/question types, reject invalid writes. Unit tests only; no SDK.
2. **Recorded extraction + approval UI** — done.
3. **One-question loop** — Fable-shaped recorded next question; answer/defer/unknown; provenance.
4. **Coach panel** — optional, separate store, excluded from SPEC compiler tests.
5. **Artifact compiler + downloads** — versioned Markdown; compiler unit tests.
6. **Live client** — Anthropic SDK behind the same `ModelClient`; localhost-only; cost meter; banner. Manual/live path; CI still recorded.

Slice 6 is the first time `@anthropic-ai/sdk` is required. Slices 1–5 must stay green with zero network.

## Proposed dependencies (not installed until named approval)

- `zod` — runtime validation of model output and ledger writes
- `better-sqlite3` — local canonical ledger (sync, explicit migrations)
- `@anthropic-ai/sdk` — live calls in slice 6 only

Do not add an ORM, vector DB, or auth library in this phase.

## Tests (offline)

- Unit: Zod reject/accept; ledger approve-vs-propose; compiler omits coach; cost cap refuses a call that would exceed $5 without confirmation flag.
- Contract: recorded Sonnet extraction and Fable question fixtures parse and round-trip.
- Browser: create synthetic project, approve one proposal, see one question, download at least one Markdown file. Use recorded client, never a live key.

## Acceptance criteria

1. A synthetic idea can complete steps 1–7 of the user-visible flow without a live API key.
2. Unapproved model proposals do not appear as facts in exports.
3. Invalid model JSON is rejected; ledger state is unchanged.
4. Exports contain no coach text unless a promotion was recorded.
5. Every persisted statement/question/answer has provenance.
6. UI shows the local-storage ≠ local-inference warning before the first live call path is usable.
7. `npm test`, `npm run test:browser`, `npm run typecheck`, `npm run lint`, and `npm run build` pass without Anthropic credentials.
8. Runtime product code cannot shell out, edit other repos, or mutate the ledger except through validated functions.
9. `test-writer` remains read-only (`Read, Grep, Glob` only).

## Owner-managed files

Do not edit `CLAUDE.md`, `.claude/settings.json`, hooks, or agents unless the owner unlocks a named file. After paths exist, the owner should add `docs/specs/`, `src/server/`, `tests/`, and `npm test` to `CLAUDE.md` Current Layout/Commands.
