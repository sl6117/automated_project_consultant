# teatime-newsletter — run baseline-2026-09 transcript for calibration

## Approved statements (index: kind: body)
- [0] fact: The project is named Teatime Post.
- [1] fact: The operator publishes a fortnightly tea-tasting newsletter.
- [2] fact: The current subscriber base is approximately 300 people.
- [3] fact: The operator drafts newsletter content in plain text.
- [4] fact: The operator wants to store and manage a subscriber list.
- [5] fact: The operator wants subscribers to be able to join or leave via a link, without operator involvement.
- [6] fact: The operator wants to send an issue to all subscribers by triggering a single action.
- [7] decision: The tool will do exactly three things: manage the subscriber list, handle self-serve subscribe and unsubscribe via link, and send the drafted issue on demand — nothing else in this phase.
- [8] fact: A successful send takes under five minutes of operator time from triggering to completion.
- [9] fact: Zero subscriber address leaks per send is a required success condition.
- [10] fact: Unsubscribes must complete without any operator involvement, ever.

## Turns
- Turn 1: Q: What observable outcome would tell you this tool worked — for example, every fortnightly issue sent with one action and zero manual list edits? | A (answered): An issue goes out in under five minutes of my time with zero address leaks, and unsubscribes never need me.

Outcome: stopped; stop offered at turn 2

## SPEC.md

# SPEC — Teatime Post

Compiled from approved ledger state only.

## Facts

- The project is named Teatime Post.
- The operator publishes a fortnightly tea-tasting newsletter.
- The current subscriber base is approximately 300 people.
- The operator drafts newsletter content in plain text.
- The operator wants to store and manage a subscriber list.
- The operator wants subscribers to be able to join or leave via a link, without operator involvement.
- The operator wants to send an issue to all subscribers by triggering a single action.
- A successful send takes under five minutes of operator time from triggering to completion.
- Zero subscriber address leaks per send is a required success condition.
- Unsubscribes must complete without any operator involvement, ever.

## Decisions

- The tool will do exactly three things: manage the subscriber list, handle self-serve subscribe and unsubscribe via link, and send the drafted issue on demand — nothing else in this phase.

## Concern coverage

- problem: The operator currently lacks a dedicated tool combining subscriber list management, self-serve opt-in/opt-out, and one-action sending; the gap is implied by the request to build one.
- user: A single operator authors and sends the newsletter; roughly 300 subscribers receive it. No other roles or collaborators are mentioned.
- workflow: Operator drafts in plain text, then triggers a send action; subscribers join or leave autonomously via a link. Entry point is the operator hitting go; exit point is delivery to the subscriber list.
- non-goals: The operator explicitly stated this is genuinely all they want; anything beyond subscriber management, subscribe/unsubscribe links, and issue sending is out of scope for this phase.
- data: The system must hold a subscriber list (at minimum email addresses). Volume is ~300 records. No retention, export, or sensitivity expectations have been stated yet.
- safety: Unsubscribe must be self-serve and reliable to avoid trapping unwilling recipients. No other safety or abuse concerns have been stated yet.
- success: The operator can observe success when: each issue sends within five minutes of operator time, no subscriber addresses are leaked, and unsubscribes resolve without operator involvement.
- safety: Zero address leaks per send is now an explicit operator requirement, not just a best-practice concern; accidental exposure of the subscriber list is a named failure mode.

