# community-garden — run baseline-2026-09 transcript for calibration

## Approved statements (index: kind: body)
- [0] fact: A community garden group is the intended user of this project.
- [1] fact: The group is experiencing organizational problems that cause friction among members.
- [2] hypothesis: Members are missing important information, tasks, or events because no adequate shared organizational system currently exists.
- [3] unknown: What specific types of things are being missed — tasks, schedules, announcements, resource bookings, or something else?
- [4] unknown: How many people are in the community garden group?
- [5] unknown: What tools, if any, does the group currently use to organize, and why are they insufficient?
- [6] fact: The primary source of friction is that shared chores — specifically watering and composting — are being skipped.
- [7] fact: Chores are skipped because members do not know whose turn or week it is to perform them.
- [8] hypothesis: A rotating or scheduled assignment system for watering and composting duties would resolve the core coordination gap.
- [9] fact: Success is defined as watering no longer being skipped and members no longer claiming they did not see the chore announcement.
- [10] hypothesis: Composting chores are implicitly included in the success condition, since the core problem named both watering and composting, but the user's answer only explicitly mentioned watering.

## Turns
- Turn 1: Q: What specific types of things are members missing — tasks, schedules, announcements, plot assignments, or resource bookings? | A (answered): Honestly the friction is about the shared chores: watering and composting get skipped because nobody knows whose week it is.
- Turn 2: Q: What observable change would tell the group the chore schedule is working — for example, watering and composting happening every week without reminders, or fewer complaints at meetings? | A (answered): If watering stops getting skipped and people stop claiming they never saw the announcement, that is a win.
- Turn 3: Q: Should the success condition explicitly include composting no longer being skipped, or is watering alone the measure that matters? | A (unknown): (none)

Outcome: stopped; stop offered at turn 4

## SPEC.md

# SPEC — Plot Notes

Compiled from approved ledger state only.

## Facts

- A community garden group is the intended user of this project.
- The group is experiencing organizational problems that cause friction among members.
- The primary source of friction is that shared chores — specifically watering and composting — are being skipped.
- Chores are skipped because members do not know whose turn or week it is to perform them.
- Success is defined as watering no longer being skipped and members no longer claiming they did not see the chore announcement.

## Decisions

No approved decisions yet.

## Concern coverage

- problem: The group experiences friction caused by members missing things, but the specific nature of what is missed and what currently happens without the project is not yet stated.
- user: Users are members of a community garden group; count, technical comfort level, and individual roles within the group are not yet known.
- problem: The concrete pain is skipped watering and composting chores caused by unclear ownership of weekly duty assignments; members miss their turns because no visible schedule exists.
- workflow: Work items are recurring chore duties (watering, composting); the handoff mechanism — who is assigned for a given week — is currently missing or invisible to members.
- success: The group will consider the project working when watering stops being skipped and members stop claiming they never saw the schedule or announcement; explicit mention of composting in the success signal is unconfirmed.

