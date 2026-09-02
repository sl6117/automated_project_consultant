# till-shift-notes — run baseline-2026-09 transcript for calibration

## Approved statements (index: kind: body)
- [0] fact: The project is for a corner shop that needs a shift handover system for staff.
- [1] fact: The handover system must capture till discrepancies at shift end.
- [2] fact: The handover system must capture deliveries that arrived during a shift.
- [3] fact: The handover system must capture items that need to be reordered.
- [4] hypothesis: Staff currently fail to fill in a paper handover notebook reliably, which is the core problem to solve.
- [5] unknown: How many staff members will use the system, and across how many shifts per day?
- [6] unknown: What device or platform will staff use to fill in handover records (shared tablet, personal phones, desktop)?
- [7] decision: Sensitive credentials mentioned in the idea (till code and alarm word) will not be stored, displayed, or referenced by the system; their handling is a safety concern to resolve with the owner.
- [8] unknown: Who is the owner or manager who reviews handover records, and do they need a separate view or role?
- [9] deferred: Whether the system needs authentication or access control for different staff roles is not yet decided.
- [10] fact: Shift handovers currently happen verbally (word of mouth) rather than in writing, so there is no recorded trail.
- [11] fact: Till discrepancies are typically discovered days after they occur, not at the time of the relevant shift.
- [12] fact: When a discrepancy surfaces, it cannot be attributed to a specific shift or staff member because no contemporaneous record exists.
- [13] hypothesis: The absence of a written record — not staff unwillingness — is the primary reason discrepancies go unresolved; a simple, low-friction recording step at shift end would change the outcome.
- [14] fact: There are six part-time staff members who will use the system.
- [15] fact: Staff will enter handover records on a single shared shop tablet.
- [16] fact: The owner reviews handover records remotely from home, not on the shop tablet.
- [17] fact: The owner reviews records on a weekly cadence, not in real time.
- [18] hypothesis: A lightweight staff-identification method (e.g. tapping a name from a list) is likely sufficient given a shared tablet with no per-user login currently planned, but this should be confirmed before building authentication.
- [19] unknown: How the owner accesses records remotely — whether via a web view, exported report, or other mechanism — is not yet stated.

## Turns
- Turn 1: Q: Why do staff currently skip the paper notebook — is it time pressure at shift change, unclear expectations, or something else? | A (answered): Handover today is word of mouth; discrepancies surface days late and nobody remembers whose shift they belong to.
- Turn 2: Q: Should each handover entry identify the specific staff member who recorded it, and if so, how will staff identify themselves at entry time (for example, tapping their name from a list versus logging in with credentials)? | A (answered): Six part-time staff on the shop tablet, and me reviewing the week from home.

Outcome: stopped; stop offered at turn 3

## SPEC.md

# SPEC — Counter Book

Compiled from approved ledger state only.

## Facts

- The project is for a corner shop that needs a shift handover system for staff.
- The handover system must capture till discrepancies at shift end.
- The handover system must capture deliveries that arrived during a shift.
- The handover system must capture items that need to be reordered.
- Shift handovers currently happen verbally (word of mouth) rather than in writing, so there is no recorded trail.
- Till discrepancies are typically discovered days after they occur, not at the time of the relevant shift.
- When a discrepancy surfaces, it cannot be attributed to a specific shift or staff member because no contemporaneous record exists.
- There are six part-time staff members who will use the system.
- Staff will enter handover records on a single shared shop tablet.
- The owner reviews handover records remotely from home, not on the shop tablet.
- The owner reviews records on a weekly cadence, not in real time.

## Decisions

- Sensitive credentials mentioned in the idea (till code and alarm word) will not be stored, displayed, or referenced by the system; their handling is a safety concern to resolve with the owner.

## Concern coverage

- problem: Staff do not reliably complete shift handover records; till discrepancies, deliveries, and reorder needs go unrecorded or uncommunicated between shifts.
- user: Corner shop staff are the primary operators filling in records; a manager or owner likely reviews them, but their role and count are not yet stated.
- workflow: Work enters at shift start or during a shift (deliveries, till events, stock needs) and must be recorded so the incoming shift can act on it; exact handoff steps and review path are not yet defined.
- data: The system will hold till discrepancy records, delivery logs, and reorder lists per shift; volume, retention period, and export needs are not yet stated.
- safety: The idea asked for live display of a till PIN and an alarm code; these must not be stored or displayed by the system — this is an unresolved credential-exposure risk that the owner must decide how to handle outside this tool.
- problem: The real failure mode is verbal-only handover: issues surface days late with no shift-level attribution, making accountability and correction impossible.
- safety: With no written record, disputed discrepancies cannot be traced to a shift or individual, creating financial accountability risk for both staff and the owner.
- success: A leading success indicator can now be stated: discrepancies are recorded at the shift they occur and are attributable to a specific shift, reducing the lag from days to same-day.
- user: Six part-time staff operate the shared shop tablet; the owner is the sole reviewer, accessing records remotely from home on a weekly basis.
- workflow: Staff record handover items on a shared tablet at the shop; the owner reviews those records remotely from home, suggesting the system needs a remote-accessible read path separate from the tablet entry point.
- operations: The system must remain usable on a single shared shop tablet with no indication of dedicated IT support; remote access for the owner implies a hosted or web-accessible component rather than a purely local solution.
- constraints: Single shared tablet as the staff-side hardware is a confirmed constraint; remote home access for the owner implies the solution cannot be purely offline or local-only.

