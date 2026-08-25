# Handoff: Baseline agent roles

## Goal

Build Automated Project Consultant, a localhost TypeScript AI project-framing
consultant and technical decision coach. Phase 0 establishes a least-privilege,
testable Claude Code harness before any product implementation begins.

## Working mode & rules in effect

Guided-driver mode is active:

- The owner types and tests core harness configuration.
- The assistant explains one concept, asks for a prediction, inspects evidence,
  deliberately tests safe failure paths, and waits at each checkpoint.
- Do not edit owner-managed files unless the owner explicitly unlocks the
  specific file.
- Owner-managed paths are `CLAUDE.md`, `.claude/settings.json`,
  `.claude/hooks/**`, and `.claude/agents/**`.
- Product code may be written by coding agents only against an approved phase
  specification with testable acceptance criteria.
- Do not edit the Cursor plan file.
- New dependencies require owner approval.
- No AWS CLI access.

## Status

Phase 0 step 7 of 8 is active. Steps 1–6 are complete and verified. Two of the
three baseline development roles are defined and break-tested:

- `code-reviewer`: complete;
- `test-writer`: complete in intentional `read-only-design` mode;
- `security-reviewer`: not yet created.

This is roughly 85% through the current Phase 0 harness setup. The next roadmap
position after the security reviewer is Phase 0 step 8: approve a concrete
tooling/specification checkpoint, then let Claude scaffold test tooling,
strict scripts, and offline CI. Product Phase 1 has not started.

## Done so far

- Repository initialized on `main`; there are still no commits.
- Clean Next.js 16.3.2 TypeScript scaffold exists.
- Owner wrote and tested the project contract in `CLAUDE.md`.
- Owner wrote `.claude/settings.json` with:
  - `acceptEdits` mode;
  - narrow allow/ask rules;
  - denies for secrets, owner-managed files, destructive/network commands,
    push, and remote changes;
  - strict Bash sandboxing with normal permissions and no unsandboxed retry.
- Permission tests passed:
  - allowed `git status` ran without approval;
  - denied `Edit(./CLAUDE.md)` was blocked and the file stayed unchanged.
- `.claude/hooks/session-start.mjs`:
  - injects bounded Git ground truth from hook JSON `cwd`;
  - real startup reported source, repository, cwd, branch, and worktree state;
  - non-Git `/tmp` input emitted an explicit unavailable warning.
- `.claude/hooks/workspace-guard.mjs`:
  - canonicalizes existing ancestors to catch traversal and symlink escapes;
  - allows in-repository `Write|Edit` calls;
  - blocks outside destinations;
  - real `/tmp` Write was denied and no file appeared.
- Strict OS sandbox:
  - confirmed `/sandbox` regular-permission mode;
  - confirmed strict mode disables unsandboxed retries;
  - Bash-launched Node wrote inside the repository;
  - Bash-launched Node received `EPERM` writing outside the repository;
  - the outside file was independently confirmed absent.
- `.claude/hooks/typecheck.mjs`:
  - runs project-wide TypeScript checks after `.ts`, `.tsx`, or `.mts`
    `Write|Edit` calls;
  - stays silent on green;
  - reports bounded structured feedback on red or unavailable verification;
  - real `page.tsx` type error produced `TS2322`, remained on disk, and was
    restored to green.
- `.claude/hooks/stop-verify.mjs`:
  - currently runs typecheck and lint because no test runner exists yet;
  - blocks the first red stop;
  - uses `stop_hook_active` for one correction cycle;
  - warns the human and allows the second still-red stop;
  - real Bash mutation proved the first-block/second-warning recursion flow;
  - source was restored, `tsc` and lint both returned exit 0.
- `.claude/agents/code-reviewer.md`:
  - tools restricted to `Read, Grep, Glob`;
  - Sonnet, high effort, eight-turn cap;
  - reviews correctness, contract, compatibility, and concrete
    maintainability risks;
  - excludes security and test design;
  - missing-input test returned structured `blocked`, read no files, and did
    not broaden scope.
- `.claude/agents/test-writer.md`:
  - intentionally read-only until real runner configuration and canonical test
    paths are approved;
  - designs minimum deterministic unit/contract/integration/browser tests;
  - first gating test exposed over-inspection and prose outside JSON;
  - input gate was tightened;
  - second identical test used no tools, emitted JSON only, returned
    `blocked`, and made no writes.
- `claude plugin validate .claude/agents` passes with both agent definitions.
- `/Users/thomaslee/Desktop/agentic-project-chapter-template.md` was updated
  with role-specialization notes and renamed to
  `/Users/thomaslee/Desktop/automation-template.md`; rename was verified.
- Disposable `.test-output` artifacts were removed after verification.
- Current verified commands:
  - `./node_modules/.bin/tsc --noEmit --pretty false` → exit 0;
  - `npm run lint` → exit 0;
  - `claude plugin validate .claude/agents` → validation passed.
- Commits: none.

## Next action (start here)

Define the owner-managed `.claude/agents/security-reviewer.md` in
guided-driver mode.

Begin with one prediction question: should its authority be read-only findings,
and should it use Sonnet as a specialist or Fable because security severity and
remediation advice are consequential? Resolve that model boundary before the
owner types frontmatter.

Expected baseline capability:

- read-only tools: `Read, Grep, Glob`;
- no Bash, Edit, Write, network, or approval authority;
- supplied scope and threat model are required inputs;
- investigate only concrete security, privacy, secret-handling, trust-boundary,
  and abuse-path risks;
- route general correctness to `code-reviewer` and test design to
  `test-writer`;
- return evidence-based structured JSON findings;
- never claim the system is secure or approve a change.

After writing it:

1. Run `claude plugin validate .claude/agents`.
2. Invoke it with missing scope and verify `blocked`, no tools, JSON only.
3. Invoke it with a narrow synthetic security scenario and verify it stays
   read-only and within scope.

## Roadmap / remaining

- Finish and test `security-reviewer` (current Phase 0 step 7).
- Review the three role boundaries together and confirm no role has approval
  authority.
- Approve a Phase 0 tooling specification with testable acceptance criteria.
- Decide canonical test layout and runner includes.
- Install only owner-approved dependencies (planned candidates include
  Vitest, Playwright, Zod, Anthropic SDK, and SQLite tooling; none are installed
  yet).
- Upgrade `test-writer` from `read-only-design` only after:
  - runner configuration exists;
  - canonical test paths exist;
  - a canonical-path mutation guard enforces test-only writes.
- Extend the Stop verification gate from typecheck+lint to the approved
  non-watch test command.
- Add strict package scripts and offline CI.
- Run install, typecheck, lint, unit tests, browser smoke tests, production
  build, and hook recursion tests.
- Create the initial reviewed commit only when explicitly requested.
- Begin Phase 1 greenfield consultant vertical slice after Phase 0 acceptance
  passes.
- Later roadmap: model routing/budgets, adaptive discovery/readiness, fixture
  evaluation, bounded swarm comparison, living feedback, and read-only
  brownfield discovery.

## Key files & locations

- Repository: `/Users/thomaslee/automated_project_consultant`
- Plan: `/Users/thomaslee/.cursor/plans/project_feedback_loop_f88bf4b1.plan.md`
- Project contract: `CLAUDE.md`
- Framework guidance: `AGENTS.md`
- Claude settings: `.claude/settings.json`
- Session hook: `.claude/hooks/session-start.mjs`
- Workspace guard: `.claude/hooks/workspace-guard.mjs`
- Post-edit typecheck: `.claude/hooks/typecheck.mjs`
- Stop verification: `.claude/hooks/stop-verify.mjs`
- Code reviewer: `.claude/agents/code-reviewer.md`
- Test writer: `.claude/agents/test-writer.md`
- Guided-driver skill: `.claude/skills/guided-driver/SKILL.md`
- Previous handoff: `handoffs/2026-08-23-1816-guided-driver-harness.md`
- This handoff: `handoffs/2026-08-24-2323-baseline-agent-roles.md`
- Reusable Desktop notes: `/Users/thomaslee/Desktop/automation-template.md`
- Current branch: `main`
- Last commit: none

## Open questions / gotchas

- All repository files are still untracked; `git status --short` lists the
  scaffold, `.claude/`, docs, and handoffs. Nothing is staged.
- `.claude/settings.local.json` exists locally after `/sandbox`; keep it local.
- `.cursor/skills/` is ignored by the user's global Git ignore. Do not alter
  global Git configuration or force-add it without approval.
- The Stop hook is a verification gate, not yet a full test gate. It runs only
  typecheck and lint until a canonical non-watch test command exists.
- TypeScript wildcard discovery excluded the hidden `.test-output` directory;
  use included source paths when deliberately testing type errors.
- The test writer must not receive `Write` or `Edit` merely through prompt
  promises. Add those tools only with canonical test paths and deterministic
  path enforcement.
- Reviewer responsibilities should have non-overlapping authority, but read
  tools may overlap.
- Bash is a capability multiplier, not a read-only convenience. Reviewers
  should receive command output from the parent instead of unrestricted Bash.
- Parent `acceptEdits` can override subagent `permissionMode`; tool allowlists
  are the reliable current reviewer boundary.
- `code-reviewer.md` has one harmless punctuation comma after the sentence
  ending in `reviewedFiles`; it can be changed to a period during the next
  owner cleanup.
- Product code still requires an approved phase spec. No `docs/specs/`
  directory or product phase spec exists yet.
- No test script, test runner, Anthropic SDK, Zod, or SQLite dependency exists.

## How to resume

Open a new chat in `/Users/thomaslee/automated_project_consultant`, attach this
file, then say:

> Continue from this handoff in guided-driver mode. Do not edit owner-managed
> files. We are in Phase 0, step 7 of 8. Next action: help me choose the
> security-reviewer model boundary, then guide me through creating and testing
> `.claude/agents/security-reviewer.md`.
