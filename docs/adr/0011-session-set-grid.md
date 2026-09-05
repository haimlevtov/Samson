# ADR 0011 — The session screen is a set grid, not a form

**Status:** accepted, phase 5
**Date:** 2026-09-05

## Context

`/workouts/[id]` was built as a form plus a receipt: one "Add a set" card that
takes an exercise, a weight, reps, RPE, rest and a warm-up flag, and below it a
read-only table of everything logged so far.

It works, and it is the wrong shape for the situation `docs/specs/mobile-interface.md`
§0 describes. Three problems, in the order they hurt:

1. **The number that decides the next set is not on the screen.** Nobody walks
   up to a bar and invents a load. They lift what they lifted last time, plus
   or minus. The old screen could only show that by scrolling to a different
   session, which nobody does mid-set.
2. **The exercise is not a unit.** A session is four or five lifts of three to
   five sets each. The form knows only "the next set", and the table sorted
   every set in the workout by exercise _name_ — so the shape of the session
   was something the user had to reassemble in their head.
3. **The form and the table are two mental models of one thing.** You type a
   set at the top and it appears, differently rendered, at the bottom. The
   thing you are about to do and the thing you did do look nothing alike.

A reference implementation was supplied: the Strong app's session screen, which
is a per-exercise grid of set rows with a `PREVIOUS` column and a tick.

## Decision

**The session screen is one grid per exercise.** A row is a set, and it is in
one of two states:

| State         | Renders as                                      | Is it in the database? |
| ------------- | ----------------------------------------------- | ---------------------- |
| **pending**   | editable kg and reps, an empty tick             | no                     |
| **performed** | the values as text, green ground, a filled tick | yes — one `sets` row   |

**Ticking a pending row is the write.** It calls the same `logSet` action the
form called, through `insertSet()` — still the single write path shared with
free-text entry. Un-ticking the last performed row of an exercise deletes that
row and returns the values to a pending row, so a mis-tap is recoverable
without retyping a weight.

Columns are `SET · PREVIOUS · KG · REPS · ✓`. **RPE, warm-up and rest length
live behind a row expansion**, opened by tapping the set number.

`PREVIOUS` comes from the most recent earlier session that contained this
exercise, rendered `80 kg × 5`. Warm-ups line up with warm-ups and working sets
with working sets: `set_index` counts both, so reading last session by raw
position would put a 42.5 kg ramp set beside today’s first working set. A row
with no counterpart of its own kind gets an em dash. Tapping it copies those
numbers into the row.

## Why

**A pending row is not a set, and must not be one.** ADR 0010 establishes that
`sets` records what a person actually lifted and that a prescribed-but-not-performed
row is indistinguishable from a performed one to `loadHistory()`, the
gamification checks, and every metric downstream. Pending rows are therefore
client state. They are persisted to `localStorage` under the workout id, not
because that is elegant but because §0 of the interface spec says the phone will
lock mid-session and nothing may live only in memory.

**This is where a template's targets land.** ADR 0010 requires the session
screen to render a prescription with zero sets logged against it, and for
tapping a target to prefill rather than log. That is exactly a pending row.

That wiring is now built, and it cost what this paragraph predicted: a session
with a `template_id` gets its pending rows from `pendingTargets()` on the
server rather than from `localStorage`, and nothing else about the screen
changed. `localStorage` keeps only what the server cannot know — the edit a
user made to a target before ticking it, and the targets they skipped. A copy
of the prescription is deliberately **not** taken: it would go stale when the
template changed and would exist only on the device that made it.

**Rest still starts on its own**, and there is still no optimistic write: a
ticked row shows a pending tick until the server confirms, and turns green only
then. Interface spec §4 — a set that did not save must never look saved.

## Deviations from the reference, and why

- **The running rest timer is pinned to the bottom of the viewport**, not
  rendered inline between the rows like the reference. Rest is rank 1 in the
  interface spec §2 — it decides when the user stands up — and an inline bar
  scrolls off the screen the moment the grid is longer than a phone. The static
  `2:00` dividers between performed rows are inline, as in the reference; only
  the live one is pinned.
- **No exercise notes.** The reference shows two note fields per exercise.
  There is no column for them, and inventing one to fill a rectangle is not a
  reason to migrate a table. `workouts.notes` still exists and is still written
  at finish.

## Consequences

- RPE is one tap further away than it was, and will be recorded less often.
  This is accepted: RPE is rank 3 in the interface spec, weight and reps are
  rank 2, and the grid's columns are what make the rank-2 pair a single glance.
  If RPE coverage collapses, the answer is a column, not a dialog.
- `src/db/training.ts` gains `loadPreviousSets()` and the pure
  `pickPreviousSets()` it delegates to. It selects; it does not compute.
- Set numbering is **positional**, not `set_index`. Deleting a middle set leaves
  a gap in the stored indices and the grid must not show one.
- The `.set-form` / `.f-*` block and the read-only logged-sets table are deleted
  rather than left beside their replacement.
- Free-text entry (`QuickLog`) is unchanged and still writes through the same
  path. It stays collapsed, below the grid.
