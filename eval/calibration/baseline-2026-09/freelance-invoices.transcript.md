# freelance-invoices — run baseline-2026-09 transcript for calibration

## Approved statements (index: kind: body)
- [0] fact: The project owner is a freelance illustrator who personally experiences the problem.
- [1] fact: Preparing invoices currently consumes the owner's evenings, representing meaningful lost personal time.
- [2] fact: The owner already logs hours and expects that log to be the input for invoice generation.
- [3] fact: The system must track payment status per invoice, distinguishing at minimum paid from unpaid.
- [4] fact: The solution must run on shared hosting the owner already pays for.
- [5] decision: The owner will not pay a recurring monthly fee for any SaaS tool to solve this problem.
- [6] unknown: What format or tool does the owner currently use to log hours, and what shape is that data in?
- [7] unknown: What does a completed invoice need to contain — line items, hourly rate, client details, tax, terms?
- [8] unknown: How many active clients and invoices per month does the owner typically manage?
- [9] unknown: What shared hosting environment is available — PHP version, database access, shell access, supported runtimes?
- [10] deferred: Whether the system needs to send invoices by email directly or only generate a downloadable file is not yet decided.
- [11] fact: Success requires that every hour logged in a given month is converted to a billed invoice within three days of month close.
- [12] fact: Success requires a dashboard or summary view that shows outstanding client balances at a glance without manual calculation.

## Turns
- Turn 1: Q: What observable outcome would tell you this project worked — for example, invoicing an evening's work in under ten minutes, or zero invoices forgotten in a quarter? | A (answered): Every month closes with all hours billed within three days and I can see outstanding balances at a glance.

Outcome: stopped; stop offered at turn 2

## SPEC.md

# SPEC — Studio Ledger

Compiled from approved ledger state only.

## Facts

- The project owner is a freelance illustrator who personally experiences the problem.
- Preparing invoices currently consumes the owner's evenings, representing meaningful lost personal time.
- The owner already logs hours and expects that log to be the input for invoice generation.
- The system must track payment status per invoice, distinguishing at minimum paid from unpaid.
- The solution must run on shared hosting the owner already pays for.
- Success requires that every hour logged in a given month is converted to a billed invoice within three days of month close.
- Success requires a dashboard or summary view that shows outstanding client balances at a glance without manual calculation.

## Decisions

- The owner will not pay a recurring monthly fee for any SaaS tool to solve this problem.

## Concern coverage

- problem: The owner spends evenings manually producing invoices from logged hours; without this project that time cost continues and payment tracking remains ad hoc.
- user: A single freelance illustrator is the sole operator and beneficiary; there is no named secondary user or client-facing role yet.
- workflow: Work enters as logged hours and exits as an invoice; payment tracking is a subsequent step, but intermediate handoffs and client communication steps are not yet described.
- data: Hour logs and invoice records are the core data; client details and payment status must be stored, but schema, volume, and retention requirements are not yet specified.
- constraints: Must run on existing shared hosting at no additional recurring cost; no SaaS subscriptions are acceptable.
- non-goals: Paying for external SaaS tooling is explicitly excluded; no other explicit non-goals have been stated yet.
- success: The project has worked when every month closes with all hours billed within three days and outstanding balances are visible at a glance — both are observable without ambiguity.

