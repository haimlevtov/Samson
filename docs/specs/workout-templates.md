# Spec — workout templates

Status: authoritative
Date: 2026-09-05
Governs: `src/templates/`, `src/db/templates.ts`, `app/templates/`

This document is the contract. As with `planner-rules.md` and
`xp-and-challenges.md`, the tests for `src/templates/` are written from this
text, and a disagreement between the two is a bug in one of them — decide
which, then change both.

Every number here is produced by code. No model is called when a template is
created, listed, started, or measured — CLAUDE.md #1. See
`docs/adr/0010-templates-prescribe-sets-record.md` for the decision this rests
on.

---

## 1. What a template is

A named, ordered list of prescribed set groups. It is a plan for one session,
not a programme: multi-week structure already exists as a `plan_runs` block and
is not duplicated here.

A template has a **source**, and the value is a fact about provenance rather
than a permission:

| `source` | Written when                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| `user`   | The trainee builds one by hand, or saves a session they have just logged — or `npm run seed`, for the demo archetypes |
| `coach`  | A session from the newest accepted plan is imported                                                                   |

Both kinds are owned by the user, editable by the user, and deletable by the
user. `source` exists so the UI can say where a template came from, and so
"what did the coach actually give me" stays answerable after the user edits it.

**The seeder writes `user` templates, and through the same door.** Each demo
archetype gets one per session of its programme's rotation, built by
`templatesFor` in `src/seed/archetypes.ts` and written by `createTemplate` as
the signed-in archetype — so the Zod bounds in §2 and the compensating delete
apply to demo data exactly as to a user's. They are `user` rather than `coach`
because `coach` means imported from an accepted plan, and nothing seeded was.

A programme lift the archetype's equipment does not allow is **left out** of its
template (`outOfGrant`): the app's own equipment filter would never offer it, and
a template is the thing a user taps Start on.

## 2. Data model

```sql
workout_templates       (id, user_id, name, source, notes, created_at, updated_at)
workout_template_items  (id, user_id, template_id, position, exercise_id,
                         set_count, reps, weight_kg, rpe, rest_seconds)
workouts.template_id    -- nullable, on delete set null
```

An item is one **set group**, the same unit ADR 0007 chose for the planner:
`3×5 at 60 kg` is one row, not three. Position is the display and matching
order and is unique within a template.

Bounds, enforced by both the Zod schema and a `check` constraint, and chosen to
match `prescribedSetGroupSchema` so a coach import can never fail validation
that the planner already passed. The item ceiling is 32 for the same reason and
not because it is a round number: the planner's own ceiling is 8 exercises of 4
set groups, so 32 is the largest session it can emit, and a lower cap here would
reject a plan that the rules and the safety critic had both accepted.

| Field          | Bound                        |
| -------------- | ---------------------------- |
| `name`         | 1–80 characters, trimmed     |
| items          | 1–32 per template            |
| `set_count`    | 1–20                         |
| `reps`         | 1–50                         |
| `weight_kg`    | 0–500, nullable (bodyweight) |
| `rpe`          | 1–10, nullable               |
| `rest_seconds` | 0–900, nullable              |

INVARIANT: `weight_kg` is kilograms and `rest_seconds` is seconds — CLAUDE.md
#8. Conversion happens at display, as everywhere else.

INVARIANT: both tables carry `user_id`, have RLS on, and have an owner-only
policy — CLAUDE.md #10.

INVARIANT: a row may only point at the user's OWN template. Owner-only on
`user_id` was not enough: a foreign key is checked as the referenced table's
owner and not under RLS, so until migration 20260911090000 a user could start a
session from, or write an item into, another user's template. `workouts_own`
and `workout_template_items_own` now check `template_id` in `with check` —
ADR 0003's 2026-09-11 amendment, tested by trying it in `tests/db/rls.test.ts`.
An item's `exercise_id` likewise has to be the user's own exercise or a shared
catalogue one (`user_id is null`), from migration `20260911100000` — the same
line `exercises_read` draws, and the one `sets` now holds too.

## 3. Starting a session from a template

```
/templates ──► [Start] ──► workouts row (status in_progress, template_id set)
                            └─► /workouts/[id] renders the prescription as targets
```

The insert is exactly what `startWorkout()` already does, plus `template_id`.
The local date comes from the user's timezone (CLAUDE.md #9).

**No `sets` rows are written.** A target renders as a **pending row** in the
session grid — ADR 0011 — carrying the prescribed weight, reps and rest, and the
user ticks it like any other row. The tick writes through `insertSet()`. One
write path, and what was prescribed never becomes a claim about what was
performed. This is ADR 0010, and it is the load-bearing rule of the whole
feature.

A session keeps its `template_id` after the template is deleted only in the
sense that it does not break: the column is `on delete set null`, so the
session survives and simply stops showing targets.

## 4. Progress — `templateProgress()`

The one derived number the user sees, so it is specified rather than left to
the UI.

```ts
export interface ItemProgress {
  itemId: string;
  prescribed: number; // set_count
  done: number; // 0..prescribed
}

export interface TemplateProgress {
  items: ItemProgress[];
  prescribedSets: number;
  completedSets: number; // capped at prescribedSets
  extraSets: number; // logged working sets beyond what was prescribed
  ratio: number; // completedSets / prescribedSets, 0 when nothing prescribed
}
```

Rules:

1. **Warm-ups never count.** A template prescribes working sets; warm-ups are
   personal, variable, and already excluded from tonnage.
2. Logged working sets are counted **per exercise**, then allocated to that
   exercise's items in ascending `position`, filling each item before the next.
   A template may prescribe the same movement twice (a ramp: `1×5 @ 60` then
   `3×5 @ 70`) and a logged set does not say which group it belonged to.
   Allocating in order is the only assumption that needs no extra data.
3. `done` never exceeds `prescribed`. Surplus lands in `extraSets`, which is
   reported and never hidden — a user who did more than was asked should see
   that, not a bar stuck at 100% with no explanation.
4. Sets of an exercise the template does not prescribe are ignored entirely.
   They are not extra work against this plan; they are different work.

## 5. Deriving a template from a logged session — `templateFromSession()`

"Save this as a template" reads what was logged and collapses it:

1. Warm-up sets are dropped (§4 rule 1).
2. Within an exercise, **consecutive** sets with the same `weight_kg` and
   `reps` collapse into one item with `set_count` = the run length.
3. `rest_seconds` is taken from the first set of the run. `rpe` is always
   `null`.

WHY `rpe` is dropped: RPE is an outcome, not an instruction. Three sets that
felt 7, 8 and 9 are one prescription, not three, and grouping by RPE would
shatter every template into single sets. A user who wants a target RPE can add
one; the deriver will not invent it from how hard last Tuesday felt.

4. A run longer than the 20-set bound splits into consecutive groups rather
   than being clamped, so no set is lost.

Sets whose `reps` is null are skipped — there is nothing to prescribe — and so
are sets whose values fall outside the bounds in §2. `sets` accepts a 0-rep
entry and a prescription cannot carry one. A session that yields no items cannot
be saved, and the action says so rather than storing an empty template.

A session holding more than 32 groups keeps its first 32, and the fact that the
tail was dropped is reported to the caller rather than handled silently.

## 6. Importing from the coach's plan — `templateFromPlannedSession()`

Input is one `PlannedSession` from the newest accepted `plan_runs` block, plus
a slug → exercise id map built from the catalogue.

- Every `set_group` becomes one item, in order, with `count`, `reps`,
  `weight_kg`, `rpe` and `rest_seconds` copied **verbatim**. Nothing is
  recomputed, rounded, or re-derived.
- An `exercise_slug` that resolves to no catalogue row fails the whole import
  and names the missing slugs. It is not silently dropped: a pressing day
  missing its press is worse than an error message.
- The name is `Week N · Day M — <focus>`, truncated to the 80-character bound.
- **A name the user already has gets a counter**: `… (2)`, then `(3)`, the
  base truncated so the whole stays inside the bound. Importing a session
  twice is allowed — a user may keep the coach's version beside an edited one —
  but the Workout tab lists templates by name, so the copies must be told
  apart. The same applies to §5's default name, `Session of <date>`. A name
  the user types is kept as typed. Decided in the rework plan, PR 7.

The block being imported has already passed `rules.ts` and the safety critic.
This step calls no model and makes no judgement; it is a copy.

## 7. Out of scope

Deliberately not built, so the boundary is on the record rather than discovered
later:

- Scheduling a template to a weekday, or generating a week of sessions from
  one. Sessions are still started by a person tapping Start.
- Sharing a template with another user. Every policy in this schema is
  `user_id = auth.uid()` — see the note in PLAN.md on what social features
  actually cost.
- Progression between runs of the same template (auto-adding 2.5 kg). That is
  the planner's job, and duplicating it here would give the user two
  disagreeing sources of what to lift next.
