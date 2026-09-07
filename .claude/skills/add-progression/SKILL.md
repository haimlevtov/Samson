---
name: add-progression
description: Add a node to an exercise progression tree in Samson. Use when adding or editing a step in the push, pull, legs or core trees, or defining what unlocks one. Covers the migration, the unlock-criteria shape, and the fact that nothing reads this table yet.
---

# Adding a progression node

Progression trees are **rows** in `public.progression_nodes`, not code —
CLAUDE.md #7. A node is one step in a skill ladder: knee push-up → push-up →
diamond push-up, each unlocked by what the user has actually logged.

## Read this first: the table has no reader

`progression_nodes` was created in the phase-0 schema and **has never been
populated or queried.** Nothing under `src/` or `app/` selects from it; only the
migration and the generated types mention it. `docs/PLAN.md` lists "Progression
trees: push, pull, legs, core" under phase 6, which is explicitly marked
compressible.

**So adding a node today makes it invisible.** You are doing one of two things,
and it is worth knowing which before you start:

1. **Seeding content for a feature somebody will build.** Fine — the rows are
   the content and the schema is settled. Say so in the migration comment, and
   do not claim the feature works.
2. **Building the feature.** Then the node is the small part. You also need a
   reader, an unlock evaluator, and a surface — and the evaluator is where the
   decisions are. Start with an ADR, not with rows.

Either way, do not describe progression trees as shipped. `docs/PRD.md` §5.5
carries the honest status.

## The row

| Column | Notes |
| --- | --- |
| `tree` | `push`, `pull`, `legs` or `core` — the CHECK enumerates them |
| `slug` | stable, lowercase, unique per user (null user = shared) |
| `name` | shown to the user |
| `exercise_id` | the catalogue row this node is. Nullable, but a node without one cannot be logged into |
| `parent_id` | the node before it. Null for a root |
| `level` | depth from the root, ≥ 0. Redundant with `parent_id` and worth it — see below |
| `unlock_criteria` | jsonb, **undefined so far** — see below |

`user_id = null` makes a node shared with every authenticated user, the same
pattern the exercise catalogue and the shipped personas use. A non-null
`user_id` is a node only that user sees.

### `level` is denormalised on purpose

It duplicates what `parent_id` already encodes. Keep it in step when inserting —
a child of a level-2 node is level 3 — because a tree walk in SQL to render one
ladder is a recursive CTE, and the level lets a surface order and group nodes
with an ordinary `order by`.

If they ever disagree, `parent_id` is the truth and `level` is the bug.

## `unlock_criteria` has no shape yet

The column is `jsonb not null default '{}'` and **no row has ever used it**, so
there is no precedent to copy and nothing validates it.

Whoever populates it first is defining the contract, and that is an ADR-sized
decision rather than a migration-sized one. Two constraints it must satisfy,
both already settled elsewhere in the project:

- **Deterministic and verifiable from logs** — CLAUDE.md #1. "Logged 3 sets of
  10 at bodyweight" works; "has good form" does not. The same rule
  `.claude/skills/add-achievement/SKILL.md` states for achievement predicates.
- **Not gameable** — an empty bar spammed for reps must not unlock the next
  node. `src/gamification/plausibility.ts` already implements these checks for
  challenges and achievements; an unlock evaluator should use it rather than
  invent a second standard.

**The obvious thing to copy is `achievements.predicate`**, which is SQL text
evaluated server-side, with the hard-won rule that a user-authored predicate is
**never executed** — ADR 0009 §3 restricts evaluation to rows where
`user_id is null`, because executing one from a user row is privilege
escalation. If `unlock_criteria` becomes anything executable, that restriction
applies to it identically and from the first migration.

A structured jsonb the evaluator interprets — rather than SQL it runs — avoids
that whole class. That is the direction to argue for.

## The migration

```sql
-- Samson NNNN — <tree> progression: <what this adds>
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7.
-- AI-NOTE: nothing reads progression_nodes yet. These rows are content for a
--          feature that is not built; do not cite them as a working tree.

insert into public.progression_nodes (user_id, tree, slug, name, exercise_id, parent_id, level)
select
  null, 'push', 'knee-push-up', 'Knee Push-Up',
  (select id from public.exercises where slug = 'knee-push-up' and user_id is null),
  null, 0;
```

Look the `exercise_id` up **by slug in the migration**, as above, rather than
pasting a UUID — the catalogue is seeded per environment and the ids differ
between your machine, CI's fresh stack and hosted.

A child references its parent the same way:

```sql
insert into public.progression_nodes (user_id, tree, slug, name, exercise_id, parent_id, level)
select
  null, 'push', 'push-up', 'Push-Up',
  (select id from public.exercises where slug = 'push-up' and user_id is null),
  (select id from public.progression_nodes where slug = 'knee-push-up' and user_id is null),
  1;
```

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
- `docs/PLAN.md` phase 6 — the planned scope
- `supabase/migrations/20260824150203_catalogue.sql` — the table
