# plant-watering-kiosk — run baseline-2026-09 transcript for calibration

## Approved statements (index: kind: body)
- [0] fact: The office contains sixty plants that require regular watering care.
- [1] fact: A rotating volunteer crew is responsible for watering the plants.
- [2] fact: Plants are currently being killed due to coordination failures: some are watered multiple times in a week while others receive no water at all.
- [3] fact: The intended interface is a kiosk display located by the kitchen.
- [4] fact: The kiosk must show which plants need water today.
- [5] fact: The kiosk must show which volunteer has claimed responsibility for watering each plant.
- [6] decision: The solution will be a kiosk-based display rather than a mobile app or email-based coordination tool.
- [7] unknown: How many volunteers are in the rotating crew and how frequently does the rotation change?
- [8] unknown: What determines whether a plant needs water on a given day — a fixed schedule, a sensor, or manual judgment?
- [9] unknown: How does a volunteer claim a plant — via the kiosk itself, a phone, or some other input method?
- [10] unknown: Who is responsible for setting up and maintaining the plant schedule and the kiosk system?

## Turns

Outcome: stopped; stop offered at turn 1

## SPEC.md

# SPEC — Leaf Duty

Compiled from approved ledger state only.

## Facts

- The office contains sixty plants that require regular watering care.
- A rotating volunteer crew is responsible for watering the plants.
- Plants are currently being killed due to coordination failures: some are watered multiple times in a week while others receive no water at all.
- The intended interface is a kiosk display located by the kitchen.
- The kiosk must show which plants need water today.
- The kiosk must show which volunteer has claimed responsibility for watering each plant.

## Decisions

- The solution will be a kiosk-based display rather than a mobile app or email-based coordination tool.

## Concern coverage

- problem: Plants are dying because volunteers over-water some plants and neglect others in the same week; the root cause is lack of visible, real-time coordination among the rotating crew.
- user: Volunteer office staff operate the system; sixty plants are the indirect beneficiaries. Crew size and rotation frequency are not yet stated.
- workflow: The workflow involves determining which plants need water today, a volunteer claiming one or more plants, and marking them as done — but the claim and completion mechanisms are not yet defined.
- data: The system must track per-plant watering schedules and daily claim status; the source of schedule data and how completion is recorded are unknown.
- operations: A physical kiosk by the kitchen must stay running and up to date daily; who owns maintenance and updates is not yet stated.
- constraints: The solution must be presentable as a kiosk in a specific physical location (by the kitchen); no budget, stack, or timeline constraints have been stated.
- non-goals: No explicit exclusions stated yet; mobile app and email-based coordination appear out of scope based on the kiosk decision, but this has not been confirmed by the user.
- success: Success is not yet defined in observable terms; implicitly, fewer plants dying and no duplicate or missed waterings would be the signal, but no threshold or measurement method has been stated.

