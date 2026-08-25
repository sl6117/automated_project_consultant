@AGENTS.md

# Automated Project Consultant

A localhost-only AI project-framing consultant that converts rough ideas into traceable, minimum-sufficient project seeds while teaching relevant engineering and AI techniques.

## Ownership Boundary

1. `CLAUDE.md`, `.claude/settings.json`, `.claude/hooks/**`, and `.claude/agents/**` are owner-managed learning files.
2. Agents must not create or edit owner-managed files unless the owner explicitly unlocks the specific file.
3. When an owner-managed step is reached, stop and explain what the owner should type, why it exists, and how to verify it.
4. Instructions to "finish all tasks" do not override an owner-action gate.

## Product Invariants

1. Baseline before swarm: the single-consultant flow and its offline evaluation must pass before runtime delegation is implemented.
2. The ledger is canonical: conversations and Markdown exports are projections, not sources of truth.
3. Humans own decisions: models may recommend or challenge, but only explicit user action approves or supersedes a decision.
4. Every model and agent boundary uses structured output with runtime validation.
5. Coaching stays separate from exported project specifications unless the user explicitly promotes it.
6. Real consultations remain private and gitignored; committed tests use synthetic fixtures and recorded responses.
7. Model budgets are contracts: exceeding the default $5 project cap requires explicit owner approval.

## Model and Data Boundaries

1. Fable handles consequential user-facing advice, readiness judgements, contradiction analysis, swarm management, and final review.
2. Sonnet handles structured extraction, candidate generation, artifact drafting, and most specialist work.
3. Cheaper models handle mechanical tasks only after task-specific evaluations prove they satisfy the contract.
4. Model identifiers, prices, and effective dates live in configuration, never individual call sites.
5. Stable policy, ontology, coaching format, and schemas form the prompt-cached prefix; dynamic project state follows it.
6. The canonical ledger supplies relevant approved state instead of replaying the complete conversation indefinitely.
7. Never send secrets, credentials, private source code, or sensitive personal documents to a model.
8. The UI must state that local storage does not mean local inference: model requests leave the machine.

## Development Rules

1. Product code requires an approved phase specification with testable acceptance criteria.
2. Tests and CI never call Anthropic or another external service; use synthetic fixtures and recorded responses.
3. Invalid model output is rejected before persistence and never partially applied.
4. Runtime agents cannot execute shell commands, edit repositories, browse, send messages, or directly mutate canonical state.
5. New dependencies require a concrete job that the existing stack cannot reasonably perform.
6. Worktrees are used only for implementation tracks with independent files and acceptance criteria.
7. Run typecheck, lint, tests, and the production build before reporting implementation complete.

## Current Layout

- `src/app/` - Next.js application routes, layouts, and UI.
- `public/` - static browser assets.
- `AGENTS.md` - Next.js-generated framework guidance imported above.
- `CLAUDE.md` - owner-managed project contract and operating rules.
- `package.json` - canonical commands and dependency manifest.
- `tsconfig.json` - TypeScript compiler contract.

Add paths to this section only after they actually exist. Documentation must not describe a fictional repository structure.

## Current Commands

- `npm run dev` - start the local development server.
- `npm run build` - create the production build.
- `npm run start` - run the production build.
- `npm run lint` - run the current ESLint configuration.