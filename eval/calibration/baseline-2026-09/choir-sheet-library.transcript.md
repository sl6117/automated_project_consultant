# choir-sheet-library — run baseline-2026-09 transcript for calibration

## Approved statements (index: kind: body)
- [0] fact: The choir owns hundreds of physical scores stored in a cupboard.
- [1] fact: There are approximately forty members in the choir.
- [2] fact: There is currently no catalog of the scores, so members cannot discover what the choir owns without asking the librarian.
- [3] fact: The librarian currently acts as a human search engine for score discovery and borrowing, which is the pain point driving this project.
- [4] fact: Scores are borrowed by members and the current state of who has what is not tracked systematically.
- [5] decision: The project will build a score catalog with borrowing tracking functionality.
- [6] unknown: Who will administer the catalog day to day — the existing librarian, a designated member, or a self-service model?
- [7] unknown: What information should each score record contain — composer, arranger, publisher, voice-part breakdown, number of copies, condition, or other fields?
- [8] unknown: What happens when a score is not returned on time — is there a reminder or escalation process?
- [9] hypothesis: Reducing librarian interruptions is the primary success signal, implying the catalog must be self-service enough that members can find and request scores without librarian involvement.
- [10] deferred: Whether the system needs to support digital scores or attachments alongside physical copy tracking is not decided.
- [11] fact: The catalog must hold approximately 400 score titles.
- [12] fact: Each title has between 10 and 50 physical copies, implying total physical copy count in the range of 4,000 to 20,000 items.
- [13] fact: The minimum required fields per score record are: title, composer, arrangement, and copy count.
- [14] decision: Scanning or attaching digital sheet music is explicitly out of scope for this project.

## Turns
- Turn 1: Q: Who will enter the hundreds of existing scores into the catalog initially, and how much time can they realistically give it? | A (answered): Roughly 400 titles, 10 to 50 copies each; title, composer, arrangement, and copy count matter; no sheet music scans in scope.

Outcome: stopped; stop offered at turn 2

## SPEC.md

# SPEC — Sheet Shelf

Compiled from approved ledger state only.

## Facts

- The choir owns hundreds of physical scores stored in a cupboard.
- There are approximately forty members in the choir.
- There is currently no catalog of the scores, so members cannot discover what the choir owns without asking the librarian.
- The librarian currently acts as a human search engine for score discovery and borrowing, which is the pain point driving this project.
- Scores are borrowed by members and the current state of who has what is not tracked systematically.
- The catalog must hold approximately 400 score titles.
- Each title has between 10 and 50 physical copies, implying total physical copy count in the range of 4,000 to 20,000 items.
- The minimum required fields per score record are: title, composer, arrangement, and copy count.

## Decisions

- The project will build a score catalog with borrowing tracking functionality.
- Scanning or attaching digital sheet music is explicitly out of scope for this project.

## Concern coverage

- problem: The librarian bears the full burden of score discovery and loan tracking for a forty-person choir with hundreds of scores; without the project, members must ask the librarian directly for every lookup and every borrow, making the role unsustainably manual.
- user: The choir has approximately forty members who borrow scores, and at least one librarian role that currently handles all catalog and borrowing queries; no information yet on technical comfort level or how members typically communicate.
- workflow: The idea names two workflow threads: (1) discovery — a member wants to know whether a score exists and where it is; (2) borrowing — a member takes a score and the system must record who has it and when it is due back. Entry and exit points for borrowing are implied but not detailed.
- data: The system must hold records for hundreds of scores and track active loans per member; the required fields per score record and per loan record are not yet specified; nothing has been said about data retention, export, or backup expectations.
- operations: The librarian is the implied operator, but whether they administer the catalog or are relieved of that duty entirely is unknown; hosting, cost, and maintenance responsibilities are not addressed.
- success: The idea implies success means the librarian stops being a human search engine, but no measurable threshold is stated — for example, reduction in direct librarian queries or percentage of borrows self-logged by members.
- data: The corpus is approximately 400 titles with 10–50 copies each; required record fields are title, composer, arrangement, and copy count; digital attachments or scans are explicitly excluded from scope.
- non-goals: Digitising or attaching sheet music scans is a confirmed non-goal for this phase.

