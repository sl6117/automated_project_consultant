# Handoff: Guided-driver harness setup

## Goal

Build Automated Project Consultant, a localhost TypeScript AI project-framing
consultant and technical decision coach. The product should turn rough ideas
into traceable minimum-sufficient project seeds, then evaluate whether a
bounded LLM-orchestrated specialist swarm adds value beyond one consultant.

## Working mode & rules in effect

Guided-driver mode is active:

- The owner types and tests core harness configuration.
- The agent explains one small chunk, asks a prediction question, reads the
  resulting evidence, deliberately tests failure where safe, and waits.
- Product code may later be written by Claude Code agents only against an
  approved phase spec.
- `CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/**`, and
  `.claude/agents/**` are owner-managed. Agents must not edit them unless the
  owner explicitly unlocks the specific file.
- “Finish all tasks” does not override an owner-action gate.
- Do not edit the plan file.

The guided-driver loop is:

```text
explain → predict → owner acts → inspect evidence → break deliberately → fix → teach back
```

## Status

Phase 0 (repository and Claude Code harness) is in progress. The clean Next.js
scaffold exists. The owner has completed the initial `CLAUDE.md` contract and
the first permission settings file. Hooks, specialized agents, test tooling,
offline CI, and product specs have not been created.

## Done so far

- Renamed the original empty directory to:
  `/Users/thomaslee/automated_project_consultant`
- Initialized Git on branch `main`; there are no commits yet.
- Generated a clean Next.js 16.3.2 TypeScript/Tailwind/ESLint scaffold.
- Owner manually wrote `CLAUDE.md`:
  - ownership boundary;
  - product invariants;
  - model/data boundaries;
  - development rules;
  - current truthful layout and commands.
- Owner manually wrote `.claude/settings.json`:
  - `acceptEdits` default;
  - narrow allow rules for current npm and read-only Git commands;
  - approval gates for installs/staging/commits;
  - denies for secrets, owner-managed files, push/remotes, destructive shell,
    and direct network commands.
- JSON syntax validation passed.
- `claude doctor` loaded successfully. Its only warning concerned macOS
  Keychain write access, not repository configuration.
- Created matching guided-driver skills:
  - Claude Code: `.claude/skills/guided-driver/SKILL.md`
  - Cursor: `.cursor/skills/guided-driver/SKILL.md`
- Existing personal `/handoff` skill remains the handoff mechanism.
- No commits exist.

## Last learning checkpoint

The owner correctly explained:

- Prompt caching lowers repeated-prefix cost, but canonical-state selection also
  prevents stale context, contradictions, attention dilution, and needless
  context growth.
- Canonical state is the authoritative approved ledger. Agents propose changes;
  structured validation, application policy, human approval, and a transaction
  update it.
- Agents must not mutate canonical state directly because concurrent agents
  could change shared truth, diverge, and recursively undermine the harness.
- Repository layout docs should list only paths that exist; planned paths look
  authoritative, waste search/read tokens, and confuse agents.

## Next action (start here)

Verify one allowed and one denied Claude Code action before adding hooks.

1. Start Claude Code from the repository and trust the folder.
2. Ask it to run `git status`; this should match an allow rule and run without
   an approval prompt.
3. Ask it to append a harmless line to `CLAUDE.md`; the `Edit(./CLAUDE.md)`
   deny rule must block the tool action and the file must remain unchanged.
4. Inspect `/permissions` if observed behavior differs.

Prediction to ask before testing:

> Which rule wins if `acceptEdits` broadly permits edits but
> `Edit(./CLAUDE.md)` explicitly denies this path, and why?

Expected answer: the specific deny wins; deny rules take precedence and apply
immediately, preserving the owner-managed source of truth.

## Roadmap / remaining

1. Complete the allow/deny permission test above.
2. Owner adds and tests `SessionStart` ground-truth injection.
3. Owner adds and break-tests `PreToolUse` workspace protection.
4. Owner adds targeted `PostToolUse` typechecking.
5. Owner adds and recursion-tests the `Stop` test gate.
6. Owner defines test-writer, code-reviewer, and security-reviewer agents.
7. Claude scaffolds planned dependencies, strict scripts, tests, and offline CI
   against an owner-approved Phase 0 spec.
8. Build the greenfield consultant vertical slice.
9. Add Fable-led routing, prompt caching, context budgets, and the $5 cap.
10. Add adaptive discovery and readiness/scope gates.
11. Build fixture-based baseline evaluation.
12. Add and measure the bounded LLM-orchestrated swarm audit.
13. Later chapters: living feedback loop and read-only brownfield discovery.

## Key files & locations

- Repository: `/Users/thomaslee/automated_project_consultant`
- Plan: `/Users/thomaslee/.cursor/plans/project_feedback_loop_f88bf4b1.plan.md`
- Project contract: `CLAUDE.md`
- Next.js generated guidance: `AGENTS.md`
- Claude settings: `.claude/settings.json`
- Claude guided-driver skill: `.claude/skills/guided-driver/SKILL.md`
- Cursor guided-driver skill: `.cursor/skills/guided-driver/SKILL.md`
- This handoff:
  `handoffs/2026-08-23-1816-guided-driver-harness.md`
- Current branch: `main`
- Last commit: none

## Open questions / gotchas

- `.cursor/skills/` is ignored by `/Users/thomaslee/.gitignore_global`, so the
  Cursor skill exists locally but does not appear in `git status`. Do not
  force-add or change global Git configuration without owner approval.
- `.claude/skills/guided-driver/SKILL.md` is visible to Git and will be shared.
- The repository currently has only create-next-app dependencies; Anthropic,
  Zod, SQLite, Vitest, and Playwright have not been installed in the clean
  restart.
- The plan's first todo remains `in_progress`; no later todo should start before
  the Phase 0 owner-action gates pass.
- Do not reproduce the earlier mistake of generating owner-managed harness files
  despite the guided-driver contract.

## How to resume

Open a new chat in `/Users/thomaslee/automated_project_consultant`, attach this
file, then say:

> Continue from this handoff in guided-driver mode. Do not edit owner-managed
> files. Next action: guide me through testing one allowed and one denied Claude
> Code permission rule.
