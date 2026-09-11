# ADR 0010 — A template prescribes; `sets` records

**Status:** accepted, phase 5 — consequences updated for ADR 0011; context amended 2026-09-11
**Date:** 2026-09-05

## Context

A trainee should be able to tap a saved template and be training within one
screen, rather than searching the catalogue for the same six movements every
Monday. Templates come from two places: the user builds one (or saves a session
they liked), and the coach's accepted plan contributes one or more per planned
session — a second import of a session is kept, its name given a counter
(amended 2026-09-12, rework PR 7).

_Amended 2026-09-11: a third, for demo data only._ `npm run seed` writes each
archetype's programme as `user` templates, through `createTemplate` as the
signed-in archetype. Nothing below changes — the seeder writes no `sets` for a
template either, and its history is written separately, as the record of what
the archetype did.

The obvious implementation is to copy the template's prescription into `sets`
rows when the session starts, so the session opens pre-populated and the user
edits the numbers that turned out differently. Several logging apps work this
way. It is wrong here, and the reason is worth recording, because the mistake is
invisible until the metrics are already wrong.

## Decision

**A template never writes a row to `sets`.**

Starting a session from a template inserts one `workouts` row carrying
`template_id`. The prescription is read from `workout_template_items` and
rendered as _targets_. A `sets` row appears only when the user logs work
through `insertSet()` — the same single write path free-text entry already uses
(`src/db/training.ts`).

Progress against the template is therefore **derived, not stored**:
`src/templates/progress.ts` matches logged working sets to prescribed groups, in
order, and is a pure function with unit tests.

## Why

`sets` is the record of what a person actually lifted. Every user-visible number
in the product reads it, unfiltered:

- `loadHistory()` selects every `sets` row for tonnage, e1RM, PR detection and
  acute:chronic workload — it does not look at `completed_at`
- the gamification plausibility checks judge submitted loads
- the seeder's archetypes are believable only because the rows mean one thing

A pre-created row is indistinguishable from a performed one. A user who starts a
five-set template, does two sets and walks out would have five counted: their
tonnage, their e1RM if the prescribed weight was ambitious, and their ACWR would
all move on work nobody did. The number would be wrong in the direction that
flatters, which is the direction nobody checks.

This is invariant #1 seen from the other side. The rule exists so that every
figure traces to something real; a fabricated set breaks that just as thoroughly
as a model inventing a total, and it is harder to notice because the arithmetic
is impeccable.

## Alternatives rejected

**Prefill with `completed_at is null`, filter it out everywhere.** This adds a
predicate that every current and future read of `sets` must remember. There are
already six of them. The first one that forgets produces a silently wrong number
rather than an error, and the metrics engine — deliberately ignorant of Supabase
so it stays trivially testable — would have to learn about a distinction that
only the template feature cares about.

**A `is_prescribed` flag on `sets`.** Same defect, plus it puts two meanings in
one table: "what was asked for" and "what was done" have different lifecycles,
different owners and different truth conditions. Splitting them is the whole
point.

**Store progress on the workout row.** A counter maintained by the application
is a second source of truth for something the `sets` rows already determine. It
would drift the first time a set was deleted.

## Consequences

- The session screen must render a plan with zero sets logged against it. That
  is the normal opening state, not an empty state.
- **A target is a pending row**, and this is now built. ADR 0011 rebuilt the
  session screen as a set grid, and a pending row is exactly what a target
  needs to be: a set the user has not performed, editable, sitting in the place
  the performed one will occupy, and absent from `sets`. The target and the
  record of the work are the same row in two states, so there is nowhere for
  the distinction to get lost. The set form this decision was originally
  written against no longer exists.
- **The remaining prescription is derived, never stored.**
  `pendingTargets()` delegates its allocation to `templateProgress()` rather
  than counting a second time, so the rows on the session screen and the
  progress figure above them cannot disagree about whether a session is
  finished. Deleting a logged set brings its target back, because nothing was
  marked done anywhere.
- **Ticking a row logs it; nothing else does.** What was prescribed and what was
  performed stay different facts, and the user confirms the second one. This
  matches the normalizer's confirm-before-write rule for the same reason.
- Deleting a template must not orphan sessions run from it, so
  `workouts.template_id` is `on delete set null`. History survives; the link
  does not.
- Coach templates copy numbers **verbatim** from a `plan_runs` block that has
  already passed the deterministic rules and the safety critic. No model is
  called when a template is created or started — the LLM's contribution was
  finished the moment that plan was accepted, and invariant #1 is untouched
  because nothing here generates a number.
