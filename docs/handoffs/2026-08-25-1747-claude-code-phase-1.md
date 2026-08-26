# Handoff: Phase 1 to Claude Code

## Goal

Continue building the approved Phase 1 greenfield consultant flow in Claude
Code. Preserve the canonical-ledger, human-approval, structured-output, privacy,
offline-test, and model-budget contracts.

## Working mode & rules in effect

- Guided-driver mode is active: the owner controls phase boundaries and
  owner-managed files; Claude Code may implement product code only against the
  approved specification.
- Owner-managed paths are `CLAUDE.md`, `.claude/settings.json`,
  `.claude/hooks/**`, and `.claude/agents/**`. Do not edit them unless the owner
  explicitly unlocks a named file.
- Do not install a new dependency without naming it, explaining its concrete
  job, and obtaining owner approval.
- Tests and CI must stay offline. Do not call Anthropic or another live model.
- Do not install `@anthropic-ai/sdk` before slice 6.
- Use worktrees only for implementation tracks with independent files and
  acceptance criteria. Do not create a worktree merely to parallelize
  overlapping edits.
- The current Phase 1 work is uncommitted on `main`. A new worktree will not
  contain it. Review and stabilize the current checkout before proposing
  worktree tracks.
- Do not commit or push unless the owner explicitly asks.
- Run typecheck, lint, unit tests, browser tests, and production build before
  reporting a product slice complete.

## Status

Phase 0 is committed. Phase 1 slices 1-3 have been implemented but are
uncommitted and need Claude Code review before the remaining slices begin.
Slices 4-6 remain.

## Done so far

- Last commit: `dd55f22 Establish the Phase 0 local harness, Next.js scaffold,
  and offline verification.`
- Approved specification:
  `docs/specs/phase-1-greenfield-slice.md`.
- Slice 1: SQLite ledger, numbered migrations, Zod contracts, provenance, and
  cost-cap logic.
- Slice 2: offline extraction stub, proposed statements, explicit approval UI,
  and local inference warning.
- Slice 3: one Fable-shaped offline question, visible selection rationale,
  answer / unknown / deferred outcomes, and user provenance.
- The start form is server-rendered so it remains visible without hydration.
- Next dev accepts `127.0.0.1` as a development origin.
- No Anthropic SDK or live model path has been added.

## Verification already run

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm test` passed: 8 files, 29 tests.
- `npm run build` passed.
- `npm run test:browser` passed: 6 Chromium tests. It was run against a
  temporary production server on port 3005 because the owner's dev server was
  already running on port 3000.

## Next action (start here)

In the existing checkout, inspect `git status`, the full uncommitted diff, and
the approved Phase 1 spec. Review slices 1-3 for correctness and contract
adherence. Run the full verification suite. Report findings and any proposed
fixes before editing. Do not start slice 4 until the owner accepts that review.

## Roadmap / remaining

1. Stabilize and review the uncommitted slices 1-3.
2. Slice 4: optional coach panel in a separate store; compiler must exclude
   coach content unless explicitly promoted.
3. Slice 5: ledger-only, versioned Markdown compiler and browser downloads.
4. Re-run the complete offline acceptance suite.
5. Slice 6: ask the owner to approve `@anthropic-ai/sdk`; then implement the
   live client behind the existing `ModelClient`, with the cost meter and
   explicit over-cap confirmation. CI remains recorded/offline.
6. Use read-only reviewer agents after implementation. The current
   `test-writer` remains read-only.

## Worktree guidance

Do not launch multiple implementation worktrees yet:

- the current Phase 1 baseline is uncommitted, so worktrees would start without
  slices 1-3;
- coach, compiler, live client, actions, and session UI have overlapping
  integration points;
- the spec requires slices 4, 5, and 6 in order.

After slices 1-3 are reviewed and committed by explicit owner request, Claude
Code may propose a worktree only for a genuinely independent track with named
file ownership and acceptance criteria. Review agents can run in parallel
because they are read-only.

## Key files & locations

- Contract: `CLAUDE.md`
- Framework guidance: `AGENTS.md`
- Approved spec: `docs/specs/phase-1-greenfield-slice.md`
- UI/actions: `src/app/`
- Ledger and migrations: `src/server/ledger/`, `src/server/db/`
- Model boundary: `src/server/model/`
- Fixtures and tests: `tests/fixtures/phase-1/`, `tests/unit/`,
  `tests/browser/home.spec.ts`
- Last commit: `dd55f22`

## Open questions / gotchas

- Existing consultations created before slice 3 have no pending question; use a
  new consultation when manually checking the question flow.
- The current question is a stub/recorded shape, not live Fable advice.
- The UI currently says “Approved facts” while the list can contain decisions,
  unknowns, and deferred statements; review whether that label should become
  “Approved ledger statements.”
- `docs/specs/phase-1-greenfield-slice.md` still describes slices 1-2 as in
  progress even though slices 1-3 are implemented. Do not edit the spec status
  without owner approval if that document is treated as the approved contract.
- `CLAUDE.md` truthfully needs layout/command additions now, but it is
  owner-managed. Stop and tell the owner exactly what to type when that gate is
  reached.

## How to resume

Start Claude Code in `/Users/thomaslee/automated_project_consultant`, paste this
whole document, then say:

“Continue from this handoff. First review and verify the existing uncommitted
Phase 1 slices 1-3. Report findings before editing; do not begin slice 4 yet.”
