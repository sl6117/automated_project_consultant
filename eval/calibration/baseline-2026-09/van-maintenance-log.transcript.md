# van-maintenance-log — run baseline-2026-09 transcript for calibration

## Approved statements (index: kind: body)
- [0] fact: The operator runs a fleet of exactly four delivery vans.
- [1] fact: Maintenance records are currently stored in a physical glovebox folder kept inside each individual van.
- [2] fact: Services are being missed under the current paper-based system.
- [3] hypothesis: Centralising maintenance records into a single digital location will prevent services from being missed.
- [4] unknown: What types of maintenance records need to be tracked (e.g. oil changes, tyre rotations, MOT, annual inspections)?
- [5] unknown: Who is responsible for logging maintenance events — drivers, a fleet manager, or a third-party garage?
- [6] unknown: How should upcoming or overdue services be surfaced — dashboard, email alerts, SMS, or another mechanism?
- [7] deferred: Whether historical records from the glovebox folders will be migrated into the new system has not been decided.
- [8] fact: Success requires zero overdue services across all four vans for a full calendar quarter.
- [9] fact: The system must be able to produce a complete printable maintenance history for any individual van, intended for use at point of sale.
- [10] hypothesis: Selling a van is an anticipated event that makes exportable per-vehicle history a near-term rather than speculative requirement.
- [11] fact: Drivers log a maintenance issue or mileage reading when they park up at the end of a run.
- [12] fact: The fleet operator reviews upcoming services on a weekly cadence and books the garage.
- [13] fact: Completed maintenance work is entered into the record from the garage invoice after the service is done.
- [14] decision: The maintenance logging workflow has three distinct roles and steps: driver capture at park-up, operator weekly review and booking, and operator post-service entry from invoice.

## Turns
- Turn 1: Q: How do you determine that a service is due for a van — fixed mileage intervals, calendar dates, manufacturer schedules, or something else? | A (answered): No overdue services across the fleet for a full quarter, and the full history of any van printable when we sell it.
- Turn 2: Q: Will the historical maintenance records currently in the glovebox folders be entered into the new system before any vans are put up for sale? | A (answered): Drivers log an issue or mileage when they park up; I check upcoming services weekly and book the garage; completed work gets entered from the invoice.

Outcome: stopped; stop offered at turn 3

## SPEC.md

# SPEC — Fleet Sheet

Compiled from approved ledger state only.

## Facts

- The operator runs a fleet of exactly four delivery vans.
- Maintenance records are currently stored in a physical glovebox folder kept inside each individual van.
- Services are being missed under the current paper-based system.
- Success requires zero overdue services across all four vans for a full calendar quarter.
- The system must be able to produce a complete printable maintenance history for any individual van, intended for use at point of sale.
- Drivers log a maintenance issue or mileage reading when they park up at the end of a run.
- The fleet operator reviews upcoming services on a weekly cadence and books the garage.
- Completed maintenance work is entered into the record from the garage invoice after the service is done.

## Decisions

- The maintenance logging workflow has three distinct roles and steps: driver capture at park-up, operator weekly review and booking, and operator post-service entry from invoice.

## Concern coverage

- problem: Maintenance records are siloed per van in physical glovebox folders, causing services to be missed; the pain is felt today by whoever manages the four-van fleet.
- user: The idea is written from the perspective of a single operator managing four vans; no other roles (drivers, mechanics, administrators) have been named yet.
- workflow: Records currently live in a per-van physical folder; no capture process, handoff sequence, or exit point for a digital workflow has been described.
- data: The data in scope is vehicle maintenance records; exact record types, volume, structure, and retention or export requirements are not yet stated.
- success: Success is framed as services no longer being missed; no measurable threshold or observable behaviour change beyond that has been specified.
- success: Two concrete, observable success criteria have been named: no overdue services across the fleet for a full quarter, and the ability to print a full van history on demand at point of sale.
- data: A full printable maintenance history per van is required, implying records must be retained for the working life of each vehicle and exportable in a human-readable format; no record types or volume have been added yet.
- non-goals: No exclusions stated, but the point-of-sale history requirement implies record completeness is in scope, not just forward-looking alerts — a boundary worth making explicit in a later pass.
- user: Three roles are now named in the workflow: drivers (who log issues and mileage), the fleet operator (who reviews, books, and enters completed work), and the garage (whose invoices are the source of truth for completed work).
- workflow: Work enters the system at two driver-side capture points (issue or mileage at park-up); the operator reviews weekly, triggers a garage booking, then closes the loop by entering completed work from the invoice. The garage itself is an external handoff point, not a system user.

