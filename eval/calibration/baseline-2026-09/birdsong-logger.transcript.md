# birdsong-logger — run baseline-2026-09 transcript for calibration

## Approved statements (index: kind: body)
- [0] fact: The user records birdsong at fixed observation spots on a weekly cadence.
- [1] fact: Recordings are currently spread across three separate drives with no organized structure.
- [2] fact: The user performs species identification on the recordings and wants those identifications stored alongside the recordings.
- [3] unknown: How many total recordings exist today and what is the approximate total storage size across the three drives?
- [4] unknown: What file formats are the recordings stored in?
- [5] unknown: What method or tool does the user use to identify species in the recordings — manual listening, a third-party app, or something else?
- [6] hypothesis: The primary goal is a searchable personal catalog, not a public or shared platform, but this has not been confirmed.
- [7] unknown: Whether the catalog needs to support playback of recordings directly, or only serve as a metadata index linking to files.
- [8] deferred: Whether recordings should eventually be migrated to a single consolidated location or remain on the three drives and be referenced in place.

## Turns

Outcome: stopped; stop offered at turn 1

## SPEC.md

# SPEC — Dawn Chorus

Compiled from approved ledger state only.

## Facts

- The user records birdsong at fixed observation spots on a weekly cadence.
- Recordings are currently spread across three separate drives with no organized structure.
- The user performs species identification on the recordings and wants those identifications stored alongside the recordings.

## Decisions

No approved decisions yet.

## Concern coverage

- problem: The user has a growing collection of birdsong recordings spanning multiple drives with no catalog, making the collection practically unusable for reference or analysis.
- user: A single user who records and identifies birdsong weekly at fixed spots; no additional operators or collaborators mentioned.
- workflow: Recordings are made at fixed spots weekly; species are identified from the recordings; both the audio files and identifications need to be linked in a catalog. Entry and identification steps are established but the cataloging step is the missing piece.
- data: Audio recordings exist across three drives in unknown formats and unknown total volume; identifications are a second data type that must be associated with recordings. Retention expectations and what must never be lost are not yet stated.
- non-goals: No explicit non-goals stated; whether sharing, collaboration, or public access are out of scope is unknown and should be confirmed early.
- success: The collection becomes 'finally usable' — but no observable metric (e.g., ability to find all recordings of a species, or browse by date and location) has been specified yet.

