# ADR 0021 — "When did this training happen" is `workouts.local_date`, never `sets.created_at`

**Status:** accepted, phase 5
**Date:** 2026-09-08

> **Written after the migration file it governs**, though before either was
> committed — so it precedes it in the log and not in the writing, which is the
> weaker of the two things the ordering rule asks for. Said plainly because
> [ADR 0020](0020-progression-unlock-criteria.md) earned the right to claim the
> stronger version and this one has not.
>
> It exists at all because [ADR 0009](0009-gamification-trust.md) and migration
> `20260908090400` have already been over this ground once and got a narrower
> answer than the problem needed. A comment on a third attempt is not enough.

## Context

`public.sets` carries three columns that look like they could order a training
history, and they mean three different things:

| Column                | Means                           | Null? | Written by                     |
| --------------------- | ------------------------------- | ----- | ------------------------------ |
| `sets.created_at`     | when the ROW was written        | no    | `default now()`                |
| `sets.completed_at`   | when the SET was finished       | yes   | the app; the seeder back-fills |
| `workouts.local_date` | the calendar day trained, local | no    | every write path               |

`twenty-percent-up` — "your best working set is 20% above your first" — has to
answer _which set came first_, and has now been wrong about it twice.

**First version:** `(array_agg(s.weight_kg order by s.created_at))[1]`.

**Second version**, migration `20260908090400`, after review: the sort had ties,
because `now()` is transaction time and a batch insert gives every row in it one
timestamp. It added `s.workout_id, s.set_index` to make the order total,
reasoning that `(workout_id, set_index)` is unique per exercise.

That reasoning is correct and the predicate was still wrong, which is the whole
reason this document exists. **A total order is not the same as the right
order.** Measured on the hosted project while seeding progression history, for
the `returning` archetype: all **179** qualifying working sets carried **one
distinct `created_at`**. The first sort key was not merely tie-prone, it was
constant. That left `workout_id` — a random uuid — deciding which of eighty-seven
sessions counted as "the one they started on".

The badge was therefore awarded by lottery, and re-running `npm run seed`
re-drew it. Best-over-first per exercise, the uuid's pick against the true
earliest session:

| Exercise                | uuid pick | true first |
| ----------------------- | --------- | ---------- |
| barbell-full-squat      | 1.15      | 1.25       |
| barbell-bench-press     | 1.16      | 1.22       |
| bent-over-barbell-row   | 1.12      | 1.19       |
| barbell-deadlift        | 1.09      | 1.19       |
| standing-military-press | 1.07      | 1.25       |
| incline-dumbbell-press  | 1.10      | 1.38       |
| romanian-deadlift       | 1.13      | 1.24       |

Every one is understated, and in the same direction: a session drawn uniformly
from a progressing history is on average much heavier than the first one, so the
ratio is always too small. This user had earned the badge on four lifts and was
told they had earned it on none.

## Decision

**Training order is `workouts.local_date`, then `sets.completed_at`, then
`sets.set_index`.** `workout_id` may follow as a tiebreak of last resort so the
order is total, but it decides nothing the three keys before it have not.

This is not a fact about one predicate. `local_date` is already the project's
canonical date — CLAUDE.md #9 says calendar-triggered achievements evaluate
against the user's local date, never server date — and "when the row was
written" is a different question that no user-facing feature has ever wanted the
answer to.

## Alternatives rejected

**Order by `sets.completed_at` alone.** It is on the same table, so no join, and
the seeder and `logSet` both populate it. Rejected because it is **nullable**:
nothing stops a set arriving without one, and a null sorts last, so a set with
no `completed_at` could never be anybody's first. That reintroduces "an
arbitrary row wins" in a narrower case, which is the bug rather than a smaller
version of it. It stays as the second key, where a null is harmless because
`local_date` has already ordered the sessions.

**Leave the predicate and accept the variance.** Defensible if the badge were
decorative. It is not: `.claude/skills/add-achievement/SKILL.md` §2 puts
"deterministic — same data, same result, always" first, and this failed it
against the same data on two different databases.

**Make `sets.created_at` meaningful by inserting one row at a time.** Rejected
without much argument — it makes `npm run seed` several hundred round trips
slower to fix a column that would still mean "write time", and the seeder is
already timed against a 60-second budget.

## Consequences

- One extra join in the most expensive predicate in the set — migration
  `20260908090200` already names `twenty-percent-up` as the one that groups and
  `array_agg`s every set. `sets.workout_id` is `not null` and foreign-keyed, so
  the join matches exactly one row and cannot change which sets are considered.
- Users who hold the badge keep it. `achievement_events` has no memory of which
  version of a predicate let them in, and the slug is never reused — the
  AI-NOTE on `20260908090400` says so and this follows it.
- **The rule generalises.** Any future predicate, metric, or chart that wants
  training order must use `workouts.local_date`. The other `created_at`
  orderings under `src/db/` — `plan_runs`, `workout_templates`, `llm_calls` —
  are fine as they are, because those tables are written one row per
  transaction and the column genuinely does order them. `sets` is the only
  bulk-written table in the schema, which is why it is the only one that broke.
