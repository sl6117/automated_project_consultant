# Phase 0 — Tooling and verification checkpoint

Status: approved for implementation of this spec only.
Product Phase 1 is out of scope.

## Goal

Give the repository an offline, non-watch verification toolchain so install, typecheck, lint, unit tests, one browser smoke test, and the production build can pass without calling Anthropic or any other live service.

## Non-goals

- Anthropic SDK, Zod, SQLite, or any product ledger/UI work.
- Upgrading `test-writer` from `read-only-design` to a writing role.
- Editing owner-managed files (`.claude/hooks/**`, `.claude/agents/**`, `.claude/settings.json`, `CLAUDE.md`) unless the owner explicitly unlocks a named file.
- A living `.test-output/` test root.

## Why `test-writer` stays read-only

Adding Vitest, Playwright, and `tests/**` does **not** give `test-writer` write authority.

- Its tool allowlist remains `Read, Grep, Glob`. Prompt text cannot add `Write` or `Edit`.
- Canonical paths existing on disk is not the mutation guard. A later, explicit upgrade may add write tools only after a path guard allows those canonical test paths and no other paths.
- Until that upgrade, `test-writer` returns JSON `plan` or `blocked` with `proposedPath: null`. Implementers (human or coding agent acting on this spec) may create tests; the specialist must not.

If someone invokes `test-writer` after this spec exists and asks it to write tests, it must still not write files. Prefer `blocked` / plan-only over inventing a workaround.

## Canonical test layout

- Unit and hook-script tests: `tests/unit/**/*.test.ts`
- Browser smoke: `tests/browser/**/*.spec.ts`
- Fixtures used by those tests: `tests/fixtures/**` (synthetic only; no real consultations, secrets, or live credentials)

Runners must not include `.test-output/`, `.next/`, or `node_modules/`.

## Approved dependencies

Install only:

- `vitest` — deterministic Node tests, including hook scripts fed synthetic stdin JSON
- `@playwright/test` — one smoke that the local app renders

Do not install the Anthropic SDK, Zod, or SQLite in this phase. Tests and CI must never call a live model; that is `CLAUDE.md` development rule 2.

## Commands

Add package scripts (names may match these exactly):

- `typecheck` — `tsc --noEmit` (non-watch)
- `test` — `vitest run` (non-watch; this is the command a later Stop-hook upgrade will call)
- `test:browser` — Playwright non-watch

Existing `lint`, `build`, and `dev` remain.

## CI

Offline GitHub Actions (or equivalent) runs `npm ci`, `typecheck`, `lint`, `test`, `test:browser`, and `next build`. No network calls to model APIs. Playwright browsers may be installed in CI as test infrastructure, not as product runtime.

## Acceptance criteria

1. `npm run typecheck` exits 0.
2. `npm run lint` exits 0.
3. `npm test` exits 0 with at least one unit test (hook-script or trivial contract) that uses no network.
4. `npm run test:browser` exits 0 with one smoke that the home page renders.
5. `npm run build` exits 0.
6. CI runs those checks without Anthropic credentials or live model calls.
7. `.claude/agents/test-writer.md` still has no `Write` or `Edit`; a missing-write-tools check can be documentary (this spec) rather than a new owner-managed edit.
8. Hook scripts continue to fail visibly when verification cannot run; they must not imply success when the runner is missing.

## Stop hook (owner-managed, later)

After `npm test` exists and is green, the owner may extend `.claude/hooks/stop-verify.mjs` from typecheck+lint to also run the non-watch `npm test` command. That edit is an owner-action gate, not part of the first implementation pass of this spec.

## Layout note

`docs/specs/` is the acceptance-first spec directory named in the Phase 0 plan. `CLAUDE.md` Current Layout should list it only after the owner adds that line (owner-managed file).
