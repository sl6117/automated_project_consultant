# school-pickup-roster — run baseline-2026-09 transcript for calibration

## Approved statements (index: kind: body)
- [0] fact: Five families share a recurring school pickup run and currently coordinate via informal morning text messages.
- [1] fact: The coordination method is described as frantic, implying it is unreliable or stressful under time pressure.
- [2] fact: The desired output is a shared roster that shows which family drives on which day.
- [3] fact: The system must support swapping turns between families, at minimum for reasons of illness or travel.
- [4] hypothesis: The five families are a fixed, closed group for the foreseeable future; the roster does not need to accommodate frequent membership changes.
- [5] unknown: How far in advance the roster is generated and whether it repeats on a fixed cycle or is built ad hoc each week.
- [6] unknown: What confirmation or acknowledgement is required when a swap is proposed and accepted.
- [7] unknown: Which platforms or devices the five families are expected to use to access the roster.

## Turns

Outcome: stopped; stop offered at turn 1

## SPEC.md

# SPEC — Gate Rota

Compiled from approved ledger state only.

## Facts

- Five families share a recurring school pickup run and currently coordinate via informal morning text messages.
- The coordination method is described as frantic, implying it is unreliable or stressful under time pressure.
- The desired output is a shared roster that shows which family drives on which day.
- The system must support swapping turns between families, at minimum for reasons of illness or travel.

## Decisions

No approved decisions yet.

## Concern coverage

- problem: Families coordinating a shared school pickup via last-minute texts causes stress and unreliability; the pain is felt by all five families every school day morning without this project.
- user: Five families are the operators and beneficiaries; all are peers with equal standing; no administrator role or scale beyond this closed group is stated.
- workflow: Work enters as a scheduled driving turn; the key handoff is a swap request triggered by illness or travel, but who initiates, who approves, and how confirmation flows is not yet defined.
- data: The roster (who drives which day) is the core data object; swap history is implied but not specified; retention period, export needs, and what must never be lost are unstated.
- non-goals: No scope exclusions are stated by the user; none can be inferred safely without risking silent assumptions.
- success: No observable success criterion is stated; a hypothesis would be that families stop using morning texts and swaps are confirmed without chasing — but this is unconfirmed.

