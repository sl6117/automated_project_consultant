# pharmacy-refill — run baseline-2026-09 transcript for calibration

## Approved statements (index: kind: body)
- [0] fact: The project is named Refill Nudge.
- [1] fact: The operator is a single pharmacist running a small independent pharmacy.
- [2] fact: A pharmacy technician handles prescription pickup on behalf of the pharmacy.
- [3] fact: The core function is to remind patients when their repeat prescriptions are due for refill.
- [4] decision: Accuracy is prioritised over coverage: no reminder is preferable to a wrong reminder.
- [5] unknown: What channels will be used to deliver reminders to patients (e.g. SMS, email, phone call, app notification)?
- [6] unknown: What data source holds current prescription and dispensing records (e.g. existing pharmacy management system, manual records)?
- [7] unknown: What defines 'due for refill' — a fixed day count before estimated run-out, a refill eligibility date from the prescriber, or something else?
- [8] unknown: What patient consent or opt-in mechanism is required before sending reminders?
- [9] fact: Reminder scheduling is triggered at the point of dispensing a repeat prescription, not by a separate review step.
- [10] fact: The reminder is scheduled to fire a few days before the estimated refill date; the exact day offset is not yet defined.
- [11] fact: When the patient picks up the prescription, the technician marks the reminder as done, closing the reminder loop.
- [12] decision: Reminders are sent without pharmacist pre-approval; the system fires automatically based on the dispense-time schedule.
- [13] decision: All patient data — names, phone numbers, and medication names — must remain stored on the pharmacy's local computer; no data may be sent to or stored in any cloud service.
- [14] fact: Patient names, phone numbers, and medication names are classified as sensitive data within this system.
- [15] decision: Reminder messages must not state the dosage or medication name; they may only indicate that a refill is due.
- [16] decision: When a patient record is unclear or ambiguous, the system must suppress the reminder entirely rather than send a potentially incorrect one.
- [17] fact: Success is defined as a noticeable drop in late pickups within two months of deployment.
- [18] hypothesis: A two-month observation window is long enough to detect a meaningful change in late-pickup frequency at this pharmacy's patient volume.

## Turns
- Turn 1: Q: Walk me through the intended path of a single reminder: when a repeat prescription approaches its due date, what happens from detection to the patient receiving the nudge, and does the pharmacist review or approve reminders before they go out? | A (answered): When I dispense a repeat, the tool schedules a reminder a few days before the refill date; the technician marks it done at pickup.
- Turn 2: Q: How is the estimated refill date calculated from a dispense event — days' supply dispensed, prescriber's eligibility date, or something else? | A (answered): Names, phone numbers, and medication names are sensitive. Everything stays on the pharmacy computer; no cloud.
- Turn 3: Q: Given that all patient data must stay on the local machine, how can a reminder physically reach a patient — does sending an SMS or email (which transmits a name, phone number, or medication reference through an external carrier) count as data leaving the machine, or is transient transmission for delivery acceptable? | A (answered): A wrong dosage or wrong-patient reminder is the nightmare case. Reminders must never state dosage, only that a refill is due, and an unclear record must produce no reminder at all.
- Turn 4: Q: What observable change would tell you Refill Nudge is working — for example, fewer patients arriving days late for refills, a target percentage of on-time pickups, or something else you can count at the counter? | A (answered): Fewer lapsed repeats: if late pickups drop noticeably within two months, it works.

Outcome: stopped; stop offered at turn 5

## SPEC.md

# SPEC — Refill Nudge

Compiled from approved ledger state only.

## Facts

- The project is named Refill Nudge.
- The operator is a single pharmacist running a small independent pharmacy.
- A pharmacy technician handles prescription pickup on behalf of the pharmacy.
- The core function is to remind patients when their repeat prescriptions are due for refill.
- Reminder scheduling is triggered at the point of dispensing a repeat prescription, not by a separate review step.
- The reminder is scheduled to fire a few days before the estimated refill date; the exact day offset is not yet defined.
- When the patient picks up the prescription, the technician marks the reminder as done, closing the reminder loop.
- Patient names, phone numbers, and medication names are classified as sensitive data within this system.
- Success is defined as a noticeable drop in late pickups within two months of deployment.

## Decisions

- Accuracy is prioritised over coverage: no reminder is preferable to a wrong reminder.
- Reminders are sent without pharmacist pre-approval; the system fires automatically based on the dispense-time schedule.
- All patient data — names, phone numbers, and medication names — must remain stored on the pharmacy's local computer; no data may be sent to or stored in any cloud service.
- Reminder messages must not state the dosage or medication name; they may only indicate that a refill is due.
- When a patient record is unclear or ambiguous, the system must suppress the reminder entirely rather than send a potentially incorrect one.

## Concern coverage

- problem: Patients miss timely refills of repeat prescriptions because they are not reminded; the pharmacy operator wants an automated nudge system to close that gap.
- user: The pharmacist is the sole operator; the pharmacy technician is a secondary actor handling pickup; patients are the beneficiaries receiving reminders. Pharmacy scale is small and independent, implying a low patient volume relative to a chain.
- safety: A wrong reminder (incorrect timing or wrong patient) could cause a patient to miss a medication dose; the operator has explicitly chosen a conservative policy of suppressing uncertain reminders rather than risking a bad one.
- quality: Correctness of reminder timing is the primary quality bar; the operator has stated a zero-tolerance stance on false reminders, accepting lower recall in exchange for higher precision.
- workflow: A repeat dispense event triggers reminder scheduling; the reminder fires a few days before refill date; the technician marks the item done at pickup. No manual pharmacist approval step exists in this path.
- data: The dispense event and refill date are the inputs needed to schedule a reminder; the technician's pickup confirmation is a state transition that must be recorded to suppress or close the reminder.
- data: Patient names, phone numbers, and medication names are the sensitive data fields held by the system; all data must remain on the pharmacy's local computer with no cloud storage or transmission.
- constraints: The system must run entirely on-premises on the pharmacy's existing computer; cloud hosting, cloud storage, and cloud processing are hard constraints excluded from any solution.
- safety: In addition to reminder accuracy risk, data residency is a safety concern: patient PII and medication names must not leave the local machine, ruling out any SaaS or cloud-connected delivery path.
- safety: Transient transmission for delivery was the open question; the operator resolved it by restricting message content to non-clinical language (refill due only, no dosage or medication name), which reduces the sensitivity of transmitted data. The nightmare case is a wrong-dosage or wrong-patient reminder, addressed by content restriction and suppression on ambiguity.
- quality: Suppression on ambiguous records is now an explicit quality rule: any uncertainty in the underlying record must produce no reminder, reinforcing the precision-over-recall stance with a concrete trigger condition.
- success: A noticeable reduction in late pickups within two months is the observable evidence of project success; no specific numeric threshold has been set, but the operator expects the change to be visible at the counter.

