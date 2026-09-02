# ramen-inventory — run baseline-2026-09 transcript for calibration

## Approved statements (index: kind: body)
- [0] fact: The ramen shop currently loses money by over-ordering perishables and running out of staples.
- [1] fact: Ordering decisions are currently made by gut feel rather than data.
- [2] fact: Supplier invoices will be a primary data input to the system.
- [3] fact: A nightly stock count will be a primary data input to the system.
- [4] decision: The system will combine inventory tracking and budget tracking in a single tool.
- [5] hypothesis: Replacing gut-feel ordering with data-driven decisions will meaningfully reduce waste and stockout costs.
- [6] unknown: Who performs the nightly stock count and enters it into the system?
- [7] unknown: How are supplier invoices currently received and in what format (paper, email, PDF, EDI)?
- [8] unknown: How many distinct SKUs or ingredients does the shop track?
- [9] unknown: What is the target budget period — daily, weekly, monthly — for the budget tracker?

## Turns

Outcome: stopped; stop offered at turn 1

## SPEC.md

# SPEC — Broth Books

Compiled from approved ledger state only.

## Facts

- The ramen shop currently loses money by over-ordering perishables and running out of staples.
- Ordering decisions are currently made by gut feel rather than data.
- Supplier invoices will be a primary data input to the system.
- A nightly stock count will be a primary data input to the system.

## Decisions

- The system will combine inventory tracking and budget tracking in a single tool.

## Concern coverage

- problem: The shop over-orders perishables and runs out of staples because ordering is driven by gut feel; the direct cost is wasted spend and lost sales from stockouts.
- user: The operator is a ramen shop (single location implied); the idea does not name who will use the system day-to-day — owner, manager, or kitchen staff — nor how many people that involves.
- workflow: Invoices from suppliers and a nightly stock count are the two entry points; the idea implies ordering decisions are the exit point, but intermediate steps and handoffs are not described.
- data: Supplier invoices and nightly stock-count figures are the core data; format, volume, and retention requirements are not stated.
- constraints: No budget, timeline, stack, or compliance constraints are stated; single-location ramen shop implies small team and likely limited technical resources.
- success: Success is implied when ordering decisions come from numbers rather than gut feel, reducing over-ordering and stockouts, but no measurable threshold or observation method is specified.

