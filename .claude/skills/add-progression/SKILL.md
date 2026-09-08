---
name: add-progression
description: Add a node to an exercise progression tree in Samson. Use when adding or editing a step in the push, pull, legs or core trees, or defining what unlocks one. Covers the migration, the unlock-criteria shape settled by ADR 0020, and the slug lookup that fails silently.
---

# Adding a progression node

Progression trees are **rows** in `public.progression_nodes`, not code —
CLAUDE.md #7. A node is one step in a skill ladder, each unlocked by what the
user has actually logged — the shipped push tree runs incline push-up →
push-up → decline push-up → parallel bar dip → handstand push-up.

_The example here used to be "knee push-up → push-up → diamond push-up", none of
which are slugs the catalogue has. Illustrating this skill with exercises that
do not exist was a small version of the mistake the whole file warns about._

## Read this first: the feature exists now

_This section used to open "the table has no reader", and said adding a node
would make it invisible. That was true from phase 0 until 2026-09-08, when the
four trees shipped in phase 5's content fill. It also said `docs/PLAN.md` listed
the trees under **phase 6**; PLAN.md lists them under phase 5, and always did._

A node you add is read, evaluated and rendered:

| Piece            | Where                                                        |
| ---------------- | ------------------------------------------------------------ |
| The contract     | [`docs/adr/0020-progression-unlock-criteria.md`](../../../docs/adr/0020-progression-unlock-criteria.md) |
| The reader       | `src/db/progression.ts`                                       |
| The evaluator    | `src/gamification/unlocks.ts` — pure, unit-tested             |
| The surface      | `app/progression-trees/page.tsx`, reached from Profile        |
| The row tests    | `tests/db/progression.test.ts`                                |

**So a node with a typo'd slug is now a user-visible bug rather than a dormant
row.** `tests/db/progression.test.ts` is what catches it; run `npm run test:db`.

## The row

| Column | Notes |
| --- | --- |
| `tree` | `push`, `pull`, `legs` or `core` — the CHECK enumerates them |
| `slug` | stable, lowercase, unique per user (null user = shared) |
| `name` | shown to the user |
| `exercise_id` | LEAVE NULL. See below — a migration cannot resolve it. |
| `parent_id` | the node before it. Null for a root |
| `level` | depth from the root, ≥ 0. Redundant with `parent_id` and worth it — see below |
| `unlock_criteria` | jsonb — the shape is ADR 0020, see below |

`user_id = null` makes a node shared with every authenticated user, the same
pattern the exercise catalogue and the shipped personas use.

**A user-owned node is read by nobody, including its author.** The write policy
was dropped in migration `20260908120100` — ADR 0002's amendment says the write
half of the catalogue pair needs a named feature behind it, and node authoring
is not one — and `loadProgressionTrees` reads only `user_id is null` rows
anyway. The column stays because CLAUDE.md #10 wants it and the RLS coverage
test looks for it. If node authoring ever becomes a feature, the policy comes
back with the null-`user_id` negative test that ADR 0002 now requires.

### `level` is denormalised on purpose

It duplicates what `parent_id` already encodes. Keep it in step when inserting —
a child of a level-2 node is level 3 — because a tree walk in SQL to render one
ladder is a recursive CTE, and the level lets a surface order and group nodes
with an ordinary `order by`.

If they ever disagree, `parent_id` is the truth and `level` is the bug.

## `unlock_criteria` — the shape, settled by ADR 0020

_This section used to say the column had no shape and that whoever filled it
first would be making an ADR-sized decision. That happened on 2026-09-08, and
the direction it argued for is the one that shipped._

**Structured JSON, validated by Zod, interpreted by an evaluator, never
executed.** The schema is `unlockCriteriaSchema` in
`src/gamification/unlocks.ts` and it is the source of truth for the shape.

```json
{}                                                          a root, always open
{ "kind": "sets_at", "exercise": "pushups", "sets": 3, "reps": 10 }
{ "kind": "sets_at", "exercise": "weighted-pull-ups", "sets": 3, "reps": 5, "weight_kg": 20 }
```

`sets_at` means N sets of at least R reps **within one completed workout**.
Three sets of ten spread over three months is not three sets of ten, and says
nothing about whether the next rung is reachable.

**Why not SQL in the column, which is what `achievements.predicate` does:**
ADR 0009 §3 restricts execution of those to `user_id is null` rows, because a
user can own an achievement row and executing one would be privilege escalation
available to anyone who can sign up. `progression_nodes` carried the same write
policy when this was decided — it was dropped in `20260908120100`, but the
argument does not depend on that: a structured criterion has no execution
semantics at all, so there is no clause for a future refactor to drop and no
policy whose removal has to be remembered. The defence is structural rather
than conditional.

Two constraints any new KIND must still satisfy:

- **Deterministic and verifiable from logs** — CLAUDE.md #1. "Logged 3 sets of
  10 at bodyweight" works; "has good form" does not.
- **Not gameable.** An empty bar spammed for reps must not open the next node.
  Prefer a rep or set count over a load, and remember that `weight_kg` is a
  floor rather than a target.

**Adding a kind is deliberately more work than adding a node**: a schema
variant, an evaluator branch and a test. Content should be cheap; vocabulary
should not.

### What cannot be expressed yet

A **timed hold**. `public.sets` has `weight_kg`, `reps`, `rpe` and
`rest_seconds` and no duration column, so "hold a plank for sixty seconds" has
nowhere to come from. The core tree's root is the plank with `{}`, and so is the
node directly above it, so that tree opens two rungs where the others open one —
asserted in `tests/db/progression.test.ts` so it stays a decision rather than a
surprise. The fix is a column, not a criterion pretending reps are seconds.

## The migration

### Do not set `exercise_id` at all

FOUND BY CI, 2026-09-08. The first version of the trees resolved it by slug in
the migration. That passed against hosted — where the catalogue had been seeded
weeks earlier — and produced twenty nulls on a fresh stack, because **the
exercise catalogue is loaded by `scripts/seed.ts`, and `npm run migrate` runs
before `npm run seed`.** A migration cannot depend on seeded data.

It also broke the seeder: the column is `ON DELETE RESTRICT`, and the seed
begins by deleting every shared catalogue row to reload the snapshot.

So a node carries a `name` and its criteria carry an exercise SLUG, and that
is all. When a "log this exercise" link is wanted, the join belongs in the
reader, by slug, at query time.

```sql
insert into public.progression_nodes (user_id, tree, slug, name, parent_id, level, unlock_criteria)
values (null, 'push', 'push-incline', 'Incline Push-Up', null, 0, '{}'::jsonb);
```

### A child cannot find its parent in the same statement

This is the trap, and it fails silently. A parent is looked up from
`progression_nodes` itself, and **a single `INSERT ... SELECT` sees the table as
it was at statement start** — so a parent inserted by the same statement is
invisible, every lookup returns null, and `parent_id` is nullable, so nothing
errors. The tree simply arrives flat.

Insert one LEVEL at a time. `20260908120000_progression_trees.sql` stages the
rows in a temporary table and loops:

```sql
do $$
declare lvl int;
begin
  for lvl in 0..(select max(level) from _tree) loop
    insert into public.progression_nodes (...)
    select ...,
      (select p.id from public.progression_nodes p
        where p.slug = t.parent_slug and p.user_id is null),
      t.level, t.criteria
    from _tree t where t.level = lvl;
  end loop;
end $$;
```

### Check every slug before you write it

The catalogue has **no** `push-up`, `pistol-squat`, `hollow-hold`,
`diamond-push-up` or `dragon-flag` — every obvious guess. It has `pushups`,
`chair-squat`, `plank`, `hanging-pike`, `inverted-row`, `chin-up`, `pullups`,
`muscle-up`. Query for the slug first; a miss writes a null and says nothing.

## Tests

A `tests/db/` case, because everything worth checking here is a property of the
rows:

- every node's `exercise_id` resolves — a null one means the slug lookup missed
  and the insert silently wrote nothing useful
- `level` equals the parent's `level + 1`, and a root has level 0
- no cycles: walking `parent_id` from any node terminates
- `tree` is consistent down a chain — a `push` node's parent is not `pull`

The lookup-missed case is the one that bites: `select` with no match inserts a
null rather than failing, so a typo'd slug produces a node pointing at nothing.

## Related

- `.claude/skills/add-achievement/SKILL.md` — the same content-as-rows pattern,
  and the predicate rules this should follow
- `docs/adr/0009-gamification-trust.md` §3 — why a user-authored predicate is
  never executed
- `docs/PLAN.md` phase 5 — where the trees are actually listed
- `docs/adr/0020-progression-unlock-criteria.md` — the criteria contract
- `supabase/migrations/20260908120000_progression_trees.sql` — the four shipped
  trees, and the model to copy
- `supabase/migrations/20260824150203_catalogue.sql` — the table
