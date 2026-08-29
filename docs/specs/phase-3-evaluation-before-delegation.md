# Phase 3 — Evaluation before delegation

Status: approved 2026-08-27 by the owner, including explicit
authorization of the maximum $15 combined Phase 3 live budget.
Implementation proceeds slice by slice under guided-driver mode. Live
calls and the workflow lab each still require their own explicit owner
initiation at execution time; approval of this document is not that
initiation.

Working mode: guided-driver, sticky. Each slice holds one learning
checkpoint at its primary AI boundary (explain → predict → owner acts →
inspect → teach back); mechanical implementation follows the checkpoint.
Owner-managed files (`CLAUDE.md`, `.claude/settings.json`,
`.claude/hooks/**`, `.claude/agents/**`) stay locked; steps that need them
stop and hand the exact edit to the owner.

## Goal

Build the evidence that decides whether routing or delegation is ever
justified: a committed corpus of 10–15 synthetic briefs with owner
reference labels, a deterministic replay harness, a calibrated judge, an
error taxonomy, regression thresholds, and a quality/cost/latency baseline
for the single consultant. The output of this phase is a decision memo, not
a swarm.

## Locked decisions (owner, 2026-08-27)

1. **Spend:** recorded-first. The harness is built and debugged entirely
   offline on recorded transcripts. Exactly one owner-initiated live
   baseline pass runs over the corpus at the end. **Owner approval of this
   specification explicitly authorizes a maximum $15 live budget for
   Phase 3** (consultant passes, retries, and judge capture combined);
   any spend beyond it requires new, separate owner authorization. Tests
   and CI never call Anthropic.
2. **Authorship:** Claude drafts the briefs (diverse domains); the owner
   edits/approves each brief and hand-authors every reference label. The
   labeling is the owner's Phase 3 learning exercise.
3. **Judge:** deterministic checks wherever possible; Sonnet judges the
   subjective rubric dimensions. Every judge run reports agreement against
   the owner's labels. No Fable judge and no third Fable task — the Phase 2
   envelope and its prompt cache stay untouched.
4. **Gate:** `npm run eval` is a separate, advisory command over recorded
   transcripts. It reports pass/fail against thresholds; it does not run
   inside `npm test` and does not block commits.

## Data categories

Four distinct kinds of data with different ownership and commit policies —
never mixed in one directory:

1. **Evaluation corpus** — `eval/briefs/<brief-id>/brief.json` +
   `labels.json`. Human-approved, committed, versioned like code. Claude
   drafts brief files and may edit them on explicit owner instruction;
   every corpus change is owner-reviewed before it is committed.
   `labels.json` is owner-authored exclusively — Claude never writes or
   edits label content.
2. **Recordings** — versioned by run:
   `eval/recordings/<run-id>/manifest.json` plus
   `eval/recordings/<run-id>/<brief-id>/consultation.jsonl` and
   `judge.jsonl`. A run id names one capture campaign under one
   configuration; the manifest records the configuration (git commit,
   model ids and price dates, prompt/judge-prompt versions, corpus brief
   list) and the content hash of every recording file in the run — the
   manifest is excluded from its own hash list and is covered instead by
   a detached hash file, `manifest.json.sha256`. Machine-captured
   from owner-initiated live passes; committed **only after passing the
   sanitization scan** (below); never hand-edited — a stale or wrong
   recording is regenerated, not patched. Multiple runs coexist so
   pairwise evaluation can load two runs simultaneously; the threshold
   config names which run is the baseline.
3. **Reports** — `eval/reports/<date>-<label>.json` (+ a readable `.md`
   projection). Dated outputs of `npm run eval`, committed, append-only;
   the designated baseline report is referenced by the threshold config.
4. **Generated artifacts** — replayed ledger databases, exported artifact
   sets, scratch output under `eval/out/`. Gitignored, fully regenerable,
   deleted freely.

`tests/fixtures/**` remains the unit-test fixture set and is unchanged by
this phase; eval recordings are not test fixtures and vice versa.

## Definitions

- **Brief:** a synthetic project idea plus a scripted persona — the answers
  that persona gives to whatever questions the consultant asks, keyed by
  concern code so the script survives wording changes. Synthetic only;
  never derived from a real consultation.

  **Deterministic answer selection.** The persona script maps each concern
  code to an **ordered list** of answer entries. For each pending question:
  take the question's `concernCodes`, order them by **ontology order** (not
  the model's order, so replay is stable across payload orderings), and
  pick the first code that still has an unconsumed entry; that entry is
  **consumed** (used at most once per consultation). A repeated question on
  the same code consumes the next entry in that code's list. When every
  code on the question is exhausted, the brief's **required fallback**
  applies: each brief declares either
  `{"disposition": "unknown"}` or
  `{"disposition": "answered", "body": "<fixed text>"}`; the harness
  refuses a brief without one. Each replay is bounded by a **maximum turn
  count** (default 12 asks per brief, configurable per brief); reaching it
  ends the replay and is scored as a *missed stop* failure, never a harness
  error.
- **Reference labels (owner-authored):** for each brief, the expected
  extraction content (statement kinds and concern codes that must appear),
  the ranked value of the candidate questions at each turn the owner chose
  to label, the correct stop turn, and any tensions that should be raised.
- **Transcript:** the full recorded consultation for one brief — every
  model payload, ledger mutation, attempt receipt, and final artifact set —
  produced by replaying the brief through the real Phase 2 pipeline.
- **Baseline:** the scored quality/cost/latency report for the current
  single-consultant implementation over the whole corpus.

## Corpus (slice 1)

- 10–15 briefs under `eval/briefs/`, one directory per brief: `brief.json`
  (idea, project name, persona answer script) and `labels.json`
  (owner-authored; the harness refuses to score a brief whose labels file
  is missing or unedited from a template).
- Domains must be diverse: at most three briefs share a domain; at least
  one brief each for a data-heavy tool, a safety-sensitive workflow, a
  constraint-dominated project, a vague/underspecified idea, and an idea
  containing content that must be refused or flagged (secrets handling).
- Difficulty spread: at least three briefs where the correct behavior is to
  stop early, at least three where core coverage is hard to reach, at
  least two containing a deliberate contradiction in the persona's answers.
- Every brief is synthetic and committed; the corpus is versioned like
  code. Real consultations never enter it (product invariant 6).

## Scoring (slice 2 deterministic, slice 3 judged)

Deterministic dimensions (computed from the transcript and ledger, no
model):

- extraction coverage vs labels (required kinds/codes present, forbidden
  content absent);
- question efficiency (turns to core coverage; asked questions vs labeled
  ranking where the owner labeled that turn);
- contradiction handling (labeled tensions raised, cited correctly, closed
  only by user action);
- stop correctness (stop offered at/after the labeled stop turn, never
  before; framing confirmable exactly when the checklist passes);
- contract discipline (zero invalid payloads persisted, zero partial
  applies — any violation is an automatic scoring failure for the brief).

Judged dimensions (Sonnet, structured output, validated):

- statement faithfulness (no invented facts relative to the brief);
- question usefulness at each labeled turn (1–5);
- minimum-sufficiency of the final artifact set (1–5).

Judge calibration: the judge scores the owner-labeled subset first; the
report always shows judge/owner agreement (exact and within-one) per
dimension. If agreement on a dimension is below the threshold set in slice
3, that dimension's judged scores are marked untrusted in every report
until the judge prompt is revised and re-calibrated.

**Hash-keyed capture and replay (consultant and judge alike).** Every
recorded entry — consultant and judge — is keyed by the SHA-256 of its
**canonicalized** complete serialized request description. Canonicalization
is **schema-aware, never textual**: only the fields the request-builder
inputs define as carrying ledger-generated ids (session, statement,
concern, question, and contradiction ids) are renumbered deterministically
by first appearance — a fresh replay mints fresh UUIDs — and the hash
input is produced by re-rendering the request through the same prompt
builders from those canonicalized structured inputs, so no find-and-
replace ever touches serialized bytes. Every other byte — prompt text,
system prefix, output config, model id, max tokens — participates in the
hash unchanged. Offline `npm run eval` resolves every
model call by exact hash lookup against the loaded run and **rejects the
run** on a miss ("recording stale or missing — owner capture pass
required"); it never falls back to a live call or a fuzzy match. Changing
a prompt, the judge prompt, the output contract, or a brief therefore
invalidates the affected hashes by construction, and recalibration always
requires a new explicitly owner-initiated capture pass. **Judge spend is
inside the $15 phase budget**: the report itemizes consultant spend and
judge spend separately, and a capture pass refuses to start when the
remaining phase budget cannot cover its estimate.

## Pairwise comparison (slice 3)

Pairwise is for changes, not absolutes: given two **runs** loaded
side-by-side (the run-versioned recording layout exists precisely for
this), the judge compares the two transcripts of the same brief (e.g.,
before/after a prompt change) and picks the better one
per dimension with a stated reason, both orders are evaluated to detect
position bias, and disagreement with the deterministic dimensions is
flagged rather than averaged away. The owner pairwise-labels a subset for
the same calibration treatment.

## Error taxonomy (slice 3)

Seed taxonomy, extended only by evidence from actual failures: invented
fact; missed core gap; redundant question; premature stop offer; missed
stop; false tension; missed tension; wrong citation; contract violation;
overlong/bundled question. Every scored failure is tagged with exactly one
primary code; counts per code appear in every report.

## Regression thresholds and reporting (slice 4)

- `npm run eval` replays the corpus offline from recorded transcripts,
  scores it, and writes a dated report to `eval/reports/` (committed).
- Thresholds live in one configuration file: minimum per-dimension mean,
  maximum count per critical error code (contract violation, invented
  fact, premature stop), and maximum allowed drop vs the baseline report.
  Advisory: the command exits nonzero on breach but nothing else blocks.
- Quality/cost/latency come from the same run: cost in integer microcents
  from the attempt ledger (settled actuals + reserved), latency from
  attempt receipts, tokens and cache hit rates included. Recorded runs
  report estimated cost only and say so.
- **Live baseline (owner-initiated, once):** after the harness is green on
  recorded transcripts, the owner runs the corpus live to produce the real
  baseline. Proposed budget: **$15 total for the phase (consultant + judge
  capture combined), $1.50 per brief for the consultant pass**, enforced
  through the existing per-session caps; exceeding either requires the
  same explicit over-cap confirmation as Phase 1/2. The API key is cleared
  after every live window. The live transcripts, once sanitized, become
  the committed recordings for future regression runs.

  **Durable phase-budget accounting.** The $15 cap is aggregated in one
  durable, committed, append-only record: `eval/budget.jsonl`, written as
  two-phase entries mirroring the attempt ledger. **Before every live
  model call**, the campaign appends a reservation entry — run id,
  session id, brief id, consultant vs judge, estimated cost in integer
  microcents — and durably flushes it (fsync) before the request is sent;
  after the call settles, a matching settlement entry is appended with
  the outcome and settled actual cost. Remaining budget = cap − settled
  actuals − **unresolved reservations at their estimates**, so a crash
  between reservation and settlement can only under-state the remaining
  budget, never over-state it. Per-session attempt ledgers remain the
  canonical source for consultation spend; the budget record aggregates
  across sessions, judge calls, failures, retries, capture campaigns, and
  process restarts — a restarted campaign re-reads the record and
  continues from the true remaining budget, never from $15. Missing,
  corrupt, or truncated budget state **fails closed**: live capture
  refuses to start, and an absent or unreadable record is never treated
  as fresh authorization — the owner restores it from git history or
  grants new explicit authorization before any further spend. (Deleting
  the file destroys history like any deletion; it cannot create budget,
  because a missing record blocks spending rather than resetting it.)
  Every report states phase spend to date against the cap.

  **Partial-pass recovery.** Briefs are independent: a brief whose
  consultation completes has its recording finalized and is never re-run
  within the pass. On a transport or validation failure mid-brief, the
  attempt ledger keeps the spend receipt, the brief is marked incomplete,
  and its partial recording is **discarded** — a retry replays that brief
  from a fresh session, because spliced transcripts are not reproducible.
  Re-running the pass retries only incomplete briefs. Spend from failed
  attempts still counts against the phase budget. **Two consecutive
  failures on the same brief halt the pass** for owner review instead of a
  third attempt, and the pass refuses to start a brief whose per-brief cap
  no longer fits the remaining budget. A baseline report is produced only
  from a fully complete corpus; a partial pass never becomes the baseline.

  **Sanitization of committed recordings.** Recordings capture only the
  serialized request description, the response payload, usage numbers,
  and latency — never transport headers or credentials. Before any
  recording is written to `eval/recordings/`, a fail-closed sanitization
  scan must pass: no API-key or authorization patterns, no absolute local
  paths or local usernames, no email addresses. `npm run eval` re-runs the
  same scan on load and refuses recordings that fail it, so an unsanitized
  file can neither be committed by the capture step nor consumed later.
  Recordings must derive only from committed synthetic briefs; nothing
  from a real consultation may enter them (product invariant 6).

## Dynamic workflow learning lab (slice 5 — separately approved)

Runs only after the single-consultant baseline exists, and only when the
owner explicitly requests the workflow at execution time (this spec's
approval is not that request):

- three read-only agents independently evaluate three fixture
  consultations; one verifier checks rubric consistency and conflicts;
- maximum four agents, no file edits, no canonical-state access;
- the orchestration script is inspected before running; token usage,
  elapsed time, and failure/recovery behavior are recorded;
- the result is compared against one agent doing the same evaluation.

Persistent ultracode stays off. Phase 4 runtime delegation stays out of
scope entirely.

## Decision memo (slice 6)

The phase closes with `docs/specs/phase-3-decision-memo.md`: baseline
numbers, calibration results, lab observations, and an explicit
recommendation — with evidence — on whether routing or delegation is
justified, deferred, or rejected. Humans own the decision; the memo
recommends.

## Implementation slices (in order, one checkpoint each)

1. **Corpus and labels.** Primary boundary: what makes a brief
   representative and a label trustworthy. Claude drafts briefs; owner
   labels. No harness code beyond schema validation of brief/label files.
2. **Replay harness (deterministic scoring).** Primary boundary: replay
   determinism vs live variance — what a recorded transcript can and
   cannot prove. Scripted personas drive the real Phase 2 pipeline
   offline; deterministic dimensions score from the ledger.
3. **Judge, calibration, pairwise, taxonomy.** Primary boundary: trusting
   a model to grade a model — agreement metrics before judged scores count.
4. **Thresholds, reports, live baseline.** Primary boundary: what a
   regression threshold protects and what it cannot see. Ends with the
   owner-run live pass and the committed baseline report.
5. **Workflow lab.** Primary boundary: when parallel agents add value.
   Requires its own explicit owner request to execute.
6. **Decision memo.** Primary boundary: evidence-based delegation
   decisions. Owner ratifies the recommendation or overrides it.

Do not start a slice until the previous slice's verification is green.

## Layout additions (owner gate)

New paths this phase introduces: `eval/briefs/`, `eval/recordings/`,
`eval/reports/`, `eval/budget.jsonl`, `eval/out/` (gitignored),
`src/eval/` (harness code), and an `eval` script in `package.json`.
`CLAUDE.md`'s Current Layout section is owner-managed: when slice 2 lands,
the owner adds these paths there; the assistant will supply the exact
lines and stop.

## Acceptance criteria

1. 10–15 committed synthetic briefs, each with owner-authored labels; the
   harness refuses unlabeled briefs.
2. `npm run eval` runs fully offline, deterministically, without
   credentials, and produces the same scores for the same transcripts.
3. Deterministic dimensions are computed only from ledger/transcript
   state; judged dimensions always carry the calibration agreement beside
   them and are marked untrusted below the agreement threshold.
4. Pairwise evaluation tests both presentation orders and reports
   position-bias checks.
5. Every scored failure carries exactly one primary taxonomy code.
6. Thresholds live in configuration; breaches exit nonzero; nothing else
   blocks — the gate is advisory by design.
7. Exactly one complete live baseline (retries of incomplete briefs
   permitted within it), owner-initiated, within the approved $15 phase
   budget covering consultant and judge capture together, through the
   existing attempt-ledger accounting; the key is cleared after every live
   window; two consecutive failures on one brief halt for owner review.
8. Persona answer selection is deterministic: ontology-ordered code
   lookup, ordered consumption, a declared per-brief fallback, and a
   bounded turn count scored as missed-stop rather than crashing.
9. Every consultant and judge call replays offline by exact
   canonicalized-request hash against a versioned run with a manifest; a
   miss rejects the run and never triggers a live call; two runs can load
   simultaneously for pairwise.
10. Corpus, recordings, reports, and generated artifacts live in separate
    locations with their stated commit policies; recordings pass the
    fail-closed sanitization scan at capture time and again at load time;
    labels are owner-authored exclusively and corpus edits are
    owner-reviewed before commit.
11. The workflow lab runs at most once, read-only, ≤4 agents, only on an
    explicit owner request separate from this spec's approval.
12. No runtime delegation, no cheaper-model routing changes, no new Fable
    task, no new runtime dependency without a concrete justified job.
13. Tests and CI remain offline throughout; real consultations never enter
    the corpus.
14. The phase ends with the decision memo, ratified by the owner.
15. The phase-budget record is two-phase: a durably flushed reservation
    precedes every live call and a settlement follows it; unresolved
    reservations count at their estimates; missing, corrupt, or truncated
    budget state fails closed and is never treated as fresh authorization
    — only new explicit owner authorization restores spending.
