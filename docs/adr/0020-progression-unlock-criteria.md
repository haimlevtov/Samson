# ADR 0020 — Unlock criteria are structured data, interpreted, never executed

**Status:** accepted, phase 5 — amended 2026-09-11
**Date:** 2026-09-08

> Written **before** the code it governs, which the three ADRs before it in this
> phase were not. `docs/plans/phase-5-content-fill.md` said PR 5 would need one
> — "whoever fills `unlock_criteria` first defines the shape, and that is
> ADR-sized rather than migration-sized" — and this is that document, in a
> commit ahead of the migration and the evaluator.
>
> _Precisely: that commit also carried an unrelated test-fixture fix, so it is
> not literally "its own commit". The ordering the rule is for holds; the
> wording claimed slightly more than the log shows, and review caught it._

## Context

`public.progression_nodes` has existed since the phase-0 schema (migration
0002). It has never held a row and nothing has ever read it. `docs/PRD.md` §5.5
describes "progression trees for push, pull, legs and core" and `docs/PLAN.md`
lists them under phase 5.

The column that needs deciding is `unlock_criteria jsonb not null default '{}'`.
No row has ever used it, so there is no precedent to copy and nothing validates
it. Whoever writes the first one is writing the contract.

**The obvious thing to copy is `achievements.predicate`** — SQL text stored in a
row and executed server-side. It works, it is already in the codebase, and it
would be the shortest path from here to a working tree.

It is also the thing [ADR 0009](0009-gamification-trust.md) §3 spends a page
containing. `achievements_write` lets any authenticated user insert their own
achievement row, so `evaluate_achievements` restricts execution to
`user_id is null` and a test asserts a user-owned predicate never runs. Removing
that clause is privilege escalation available to anyone who can sign up.

`progression_nodes` carried **the same write policy** when this was written,
from the same catalogue pattern (ADR 0002). So SQL-in-a-column here would have
inherited the identical hazard, and the identical one-clause defence that must
never be forgotten. (That policy was dropped later the same day — migration
`20260908120100` — which removes the hazard from this table but not the reason
the shape below is the right one: a structured criterion needs no policy to stay
safe.)

## Decision

**`unlock_criteria` is structured JSON that an evaluator interprets. It is never
executed, and there is no code path that could execute it.**

Validated by a Zod schema (`src/gamification/unlocks.ts`), which is the single
source of truth for the shape per the project's conventions.

```json
{}                                                   a root: nothing to meet
{ "kind": "never" }                                  met by nothing, ever
{ "kind": "sets_at", "exercise": "pushups", "sets": 3, "reps": 10 }
{ "kind": "sets_at", "exercise": "weighted-pull-ups", "sets": 3, "reps": 5, "weight_kg": 20 }
```

`sets_at` means "N sets of at least R reps of this exercise, **within one
completed workout**". `weight_kg` is an optional **floor**, omitted entirely for
a bodyweight node — the schema takes `.positive().optional()` rather than
allowing `0` or `null`, because either would demand a recorded weight and lock a
bodyweight movement out permanently.

`never` exists for `src/db/progression.ts`'s fallback and is described in
Consequences.

A node is unlocked when its criteria are met **and its parent is unlocked**.
That is what makes it a tree rather than a checklist, and it is what lets the
surface say what is next rather than only what is done.

### Why not SQL, stated as the security argument it is

A structured criterion has no execution semantics at all. There is no way for a
user-authored row to become code, and no `where user_id is null` clause guarding
an `EXECUTE`. The defence is structural rather than conditional, which is the
difference between ADR 0009's achievement predicates — where the defence is one
`where` clause and a test — and this.

> **Corrected 2026-09-08, the day this was written.** The sentence above
> originally also claimed there was "no `user_id is null` filter that a future
> refactor can drop". That was false about the shipped code:
> `loadProgressionTrees` carries exactly such a filter, and it was the only
> thing keeping user-authored rows out of the rendered tree — which mattered,
> because `progression_nodes_slug_unique` is `nulls not distinct`, so a user row
> could reuse a system slug and `unlockStates` keys its map by slug.
>
> The hazard this decision removes is **execution**, not that filter. The filter
> moved from a SQL clause into TypeScript, where it is arguably less visible.
> Migration `20260908120100` closes the gap properly by dropping the write
> policy — there is no node-authoring feature, so per ADR 0002's amendment the
> write half of the catalogue pair had nothing behind it — and
> `tests/db/progression.test.ts` now asserts both directions.

The cost is expressiveness: a criterion can only say what the schema has a word
for. That is the right trade for content authored by this project, and the
schema grows by adding a variant with its own validation and its own test.

### What a node that fails to parse does

**Nothing, visibly.** It is treated as locked, and the tree renders without it
rather than throwing. A malformed row is a content bug, and a content bug must
not take out a page — `src/db/personas.ts` already re-validates jsonb on read
for the same reason: "the database will hand back
whatever was written, including a row written by an older schema version."

## Naming

The evaluator is `src/gamification/unlocks.ts`, not `progression.ts`.
`src/metrics/progression.ts` already exists and means something else — how heavy
a lift has become over time, the data behind the chart in
[ADR 0014](0014-exercise-progression-chart.md). [ADR 0018](0018-tonnage-comparisons.md)
noted that "progression" was becoming an overloaded word in this codebase; this
is the change that would have overloaded it.

The user-facing name stays **progression trees**, because that is what
`docs/PLAN.md` and the PRD call them and what the table is named. The code file
is named for the question it answers.

## Consequences

- **Adding a node is a migration**, and adding a KIND of criterion is a schema
  change plus an evaluator branch plus a test. That asymmetry is deliberate:
  content should be cheap and vocabulary should not.
- **`exercise` is a slug, not a UUID.** Catalogue ids differ between a local
  stack, CI's fresh stack and hosted, so a criterion carrying an id would be
  correct in exactly one environment.

- **`progression_nodes.exercise_id` is left NULL, and that is not an oversight.**
  Found by CI after this ADR was written: the migration originally resolved it
  by slug, which passed against hosted — where the catalogue had been seeded
  weeks earlier — and produced twenty nulls on a fresh stack, because the
  exercise catalogue is loaded by `scripts/seed.ts` and `npm run migrate` runs
  before `npm run seed`. **A migration cannot depend on seeded data.** The same
  migration was producing different content in different environments, which is
  the trap this ADR warns about for UUIDs, arrived at by another road.

  It also broke the seeder outright: the column references
  `exercises (id) ON DELETE RESTRICT`, and the seed begins by deleting every
  shared catalogue row to reload the snapshot.

  Nothing reads the column — the page renders `progression_nodes.name`, and the
  criteria carry their own slug, matched against logged sets rather than against
  the catalogue. When a "log this exercise" link is wanted, the join belongs in
  the READER, resolved by slug at query time, where a missing catalogue row is a
  missing link rather than a permanently wrong id.

- **A timed hold cannot be expressed yet.** `public.sets` has `weight_kg`,
  `reps`, `rpe` and `rest_seconds` but no duration column, so "hold a plank for
  60 seconds" has nowhere to come from. The core tree's root is the plank with
  no criteria, and the rep-based nodes hang below it. Recorded rather than
  worked around: the fix is a duration column, not a criterion that pretends
  reps are seconds.
- **`level` stays denormalised** and must agree with `parent_id`, as the skill
  says. `tests/db` asserts it, along with no cycles and no tree changing
  mid-chain.

## Amended 2026-09-11 — a criterion is a promise the app has to be able to keep

A criterion names the lift that opens the rung above it, and the evaluator
matches it against logged sets. So a criterion naming a lift nobody can log is a
rung nobody can open — and it looks exactly like a rung nobody has opened yet.
The tree renders, the rung stays locked, and the lift it asks for never appears
in the picker.

**Found in review of PR #42.** The home-gym programme carried `chair-squat`,
which the catalogue tags `machine` and home-gym does not own. Tracing why led to
the legs tree, where three of the five rungs had been chosen by NAME, and all
three names mislead:

| Rung               | Slug                         | What the catalogue entry describes                                      |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------- |
| Chair Squat (root) | `chair-squat`                | A Smith-machine squat: set the bar, step under it, lift it off the rack |
| Split Squat        | `split-squats`               | A jumping split, filed under `stretching`                               |
| Pistol Squat       | `smith-machine-pistol-squat` | A Smith-machine split stance, not a pistol                              |

`availableExercises` offers only lifts in `PROGRAMMABLE_CATEGORIES` whose
equipment tag the user owns. So a user without a machine could never log the
root's lift, and the tree stopped at its root for every bodyweight user — the
audience a squat ladder exists for. And `split-squats` is `stretching`, which the
picker filters out for everyone, so the pistol rung could not open for any user
at all. Migration `20260908120000` records that every slug "was confirmed to
exist first". Each one did. Existing was the wrong test; the question is whether
the app will let a user log it.

**Decision: change the tree, not the tag.** The three candidates, and why two
were refused:

- **Retag `chair-squat` as `bodyweight`.** Refused: the source is right about a
  lift that needs a rack, and the tree was wrong about it. A catalogue that lies
  to fix a tree breaks the equipment filter for everyone who reads it — which is
  CLAUDE.md #5's whole point.
- **Change only the programme.** Refused as the whole fix: it would satisfy the
  seed's check and leave the root unreachable for every real bodyweight user.
  The programme changes too, but as a consequence.
- **Change the tree.** Chosen. The legs tree is rebuilt from lifts the catalogue
  files as bodyweight and programmable, each checked against its instructions
  rather than its name:

| Level | Rung                    | Opens with                      |
| ----- | ----------------------- | ------------------------------- |
| 0     | Bodyweight Squat        | — the root                      |
| 1     | Walking Lunge           | 3 × 20 bodyweight squats        |
| 2     | Step-Up with Knee Raise | 3 × 16 walking lunges           |
| 3     | Split Jump              | 3 × 12 step-ups with knee raise |

It is a rung shorter than before. The catalogue has no bodyweight pistol or
split squat a user can log — `split-squats` is the jumping split above, and the
real ones need dumbbells, a kettlebell or a Smith machine — so the ladder ends
on the explosive single-leg rung the catalogue does have, rather than on a name.
The two criteria that survive keep their numbers. The step-up needs a step or a
bench; the source files it under bodyweight, and so does this. Migration
`20260911120000`.

The home-gym programme's appended `chair-squat` becomes `bodyweight-squat` — what
its comment, "push-ups and air squats", meant all along — prescribed at 3 × 21,
because a later set drops a rep a quarter of the time and the next rung asks for
twenty.

**The rule, held by a test.** Every criterion names a lift `availableExercises`
offers a user who owns every equipment tag, so no rung is closed to everyone. And
the rung above every root opens with bodyweight alone, so every tree can be
started with a floor. `tests/db/progression.test.ts` asks the app's own reader,
for real users with real grants, rather than re-deriving the answer from the
category list.

It also pins the rungs a bodyweight-only user cannot open. Three remain, all
above the first rung, all asking for gear the catalogue tags `other`:
`push-handstand` (it asks for parallel-bar dips), `pull-chin` (band-assisted
pull-ups) and `pull-muscle-up` (weighted pull-ups). Those are content decisions
of their own rather than bugs of this kind — a dip needs bars — and they are
tracked in `docs/plans/README.md`. A fourth fails CI.

## Related

- [ADR 0009](0009-gamification-trust.md) §3 — why a user-authored predicate is
  never executed, which is the hazard this shape removes rather than defends.
- [ADR 0002](0002-catalogue-user-id.md) — the shared-content policy pair
  `progression_nodes` carries, and the 2026-09-08 amendment on when the write
  half is worth having.
- `.claude/skills/add-progression/SKILL.md` — written before any of this
  existed, and correct: it said the first author of this column would be making
  an ADR-sized decision.
