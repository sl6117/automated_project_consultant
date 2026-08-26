# AI Engineering Learning Roadmap

Status: Phase 1 active.

This roadmap tracks what the owner should learn while building the product. It
is separate from phase specifications, which define product behavior and
acceptance criteria. Claude Code may implement mechanical work, but each AI
boundary should use the guided-driver loop:

```text
explain → predict → owner acts → inspect evidence → break safely → fix → teach back
```

## Phase 0 — Agent harness

Learn least-privilege permissions, owner-managed boundaries, lifecycle hooks,
structured reviewer outputs, sandboxing, and offline verification gates.

Evidence: allowed and denied operations, deliberate hook failures, and a green
offline CI baseline.

## Phase 1 — Reliable model boundaries

Learn:

- structured model output and runtime validation with Zod;
- canonical ledger state versus conversation and export projections;
- provenance, human approval, and revision chains;
- transaction boundaries around model calls;
- stub, recorded, and live model clients behind one interface;
- deterministic offline tests for nondeterministic services;
- prompt construction, caching boundaries, and cost caps.

Owner interactions include predicting malformed-output behavior, inspecting
fixtures and schemas, safely breaking one model payload, verifying rollback,
and comparing what stub and recorded browser tests do and do not prove.

## Phase 2 — Adaptive consultation

Learn context selection from canonical state, concern coverage, uncertainty and
value-of-information scoring, contradiction detection, question ranking, and
stopping when the first project slice is sufficiently framed.

The owner ranks candidate questions, labels synthetic consultations, compares
those choices with the model, and tunes a visible selection rubric.

## Phase 3 — Evaluation before delegation

Learn synthetic eval design, rubrics, pairwise comparison, error taxonomies,
calibration, regression testing, and quality-cost-latency tradeoffs. Use
evidence from 10–15 synthetic briefs to decide whether routing or delegation is
justified.

### Dynamic workflow learning lab

After the single-consultant evaluation baseline exists, run one bounded,
read-only Claude Code dynamic workflow:

- three agents independently evaluate three synthetic consultation fixtures;
- one verifier checks rubric consistency and conflicting findings;
- maximum four agents and no file edits;
- inspect the generated orchestration script;
- record token usage, elapsed time, and failure or recovery behavior;
- compare the result with one agent performing the same evaluation.

Learning objectives:

- task decomposition;
- fan-out and fan-in;
- verifier and synthesis patterns;
- workflow scripts versus conversational orchestration;
- permission inheritance and sandbox behavior;
- token budgeting;
- deciding when parallel agents add value.

Do not enable persistent ultracode for this project before this lab. Request the
workflow explicitly so its scope, agent count, permissions, and evidence are
reviewed first.

## Phase 4 — Bounded runtime swarm

Learn manager-worker orchestration, structured delegation, complementary versus
redundant specialists, concurrency and budget limits, result synthesis, and
ablation against the single-consultant baseline.

Runtime agents remain unable to mutate canonical state directly. The owner
approves the delegation design and compares quality, cost, and latency before
claiming that the swarm adds value.

## Phase 5 — Living feedback

Learn observability, user feedback capture, error and drift analysis, and how
evaluation cases evolve without leaking private consultations into committed
fixtures.

## Phase 6 — Brownfield consultation

Learn repository retrieval, context selection, source attribution, privacy
boundaries, and safe read-only tooling for framing projects in an existing
codebase.
