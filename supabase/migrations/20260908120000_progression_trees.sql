-- Samson 0046 — the four progression trees
--
-- Plan: docs/plans/phase-5-content-fill.md, PR 5.
-- Contract: docs/adr/0020-progression-unlock-criteria.md, committed first.
-- Skill: .claude/skills/add-progression/SKILL.md.
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7.
--
-- `progression_nodes` was created in the phase-0 schema (migration 0002) and
-- has held no rows and had no reader since. This is both: the rows here, and
-- src/db/progression.ts plus src/gamification/unlocks.ts in the same change.
-- The add-progression skill's "read this first: the table has no reader" note
-- is updated by this change rather than left standing.
--
-- ---------------------------------------------------------------------------
-- unlock_criteria
-- ---------------------------------------------------------------------------
--
-- INVARIANT: structured JSON, interpreted, NEVER executed — ADR 0020. Validated
--            by `unlockCriteriaSchema` in src/gamification/unlocks.ts, which is
--            the source of truth for the shape.
--
--   {}                                                    a root, always open
--   {"kind":"sets_at","exercise":"<slug>","sets":3,"reps":10}
--
-- "sets_at" means N sets of at least R reps WITHIN ONE COMPLETED WORKOUT.
-- Three sets of ten is a session, not a lifetime total; spread over six months
-- it says nothing about whether the next rung is reachable.
--
-- AI-NOTE: `exercise` is a catalogue SLUG. It is not a uuid, and it must not
--          become one — ids differ between a local stack, CI's fresh stack and
--          hosted, so a criterion carrying an id is correct in exactly one
--          environment. The same trap as exercise_id below.
--
-- ---------------------------------------------------------------------------
-- Every slug below was checked against the catalogue before being written
-- ---------------------------------------------------------------------------
--
-- The skill warns that a `select` with no match inserts a NULL rather than
-- failing, so a typo produces a node pointing at nothing and nothing complains.
-- Checked, and it mattered: the catalogue has no `push-up`, no `pistol-squat`,
-- no `hollow-hold` and no `dragon-flag` — the obvious guesses. It has `pushups`,
-- `chair-squat`, `plank` and `hanging-pike`. Every slug here was confirmed to
-- exist first, and tests/db/progression.test.ts asserts every exercise_id
-- resolved.
--
-- ---------------------------------------------------------------------------
-- The core tree starts with a hold, and holds cannot be criteria yet
-- ---------------------------------------------------------------------------
--
-- `public.sets` has weight_kg, reps, rpe and rest_seconds and no DURATION
-- column, so "hold a plank for sixty seconds" has nowhere to come from. The
-- plank is therefore a root with no criteria and the rep-based nodes hang below
-- it. Recorded in ADR 0020 rather than worked around: the fix is a column, not
-- a criterion that pretends reps are seconds.

-- ---------------------------------------------------------------------------
-- WHY a staging table and a loop rather than one INSERT ... SELECT
-- ---------------------------------------------------------------------------
--
-- A parent is looked up by slug from `progression_nodes` itself, and a single
-- INSERT ... SELECT sees the table as it was at STATEMENT START — so every
-- parent lookup would return null and every node would silently become a root.
-- Silently is the operative word: `parent_id` is nullable, so nothing would
-- have failed, and the trees would simply have arrived flat.
--
-- Inserting one LEVEL at a time makes each parent committed before its children
-- look for it. tests/db/progression.test.ts asserts the result — level agrees
-- with parent_id, and only the roots have none.

create temporary table _tree (
  tree text,
  slug text,
  name text,
  exercise_slug text,
  parent_slug text,
  level int,
  criteria jsonb
) on commit drop;

insert into _tree (tree, slug, name, exercise_slug, parent_slug, level, criteria)
select v.tree, v.slug, v.name, v.exercise_slug, v.parent_slug, v.level, v.criteria::jsonb
from (
  values
    -- PUSH ---------------------------------------------------------------
    ('push', 'push-incline',    'Incline Push-Up',    'incline-push-up',    null,              0,
     '{}'),
    ('push', 'push-full',       'Push-Up',            'pushups',            'push-incline',    1,
     '{"kind":"sets_at","exercise":"incline-push-up","sets":3,"reps":12}'),
    ('push', 'push-decline',    'Decline Push-Up',    'decline-push-up',    'push-full',       2,
     '{"kind":"sets_at","exercise":"pushups","sets":3,"reps":15}'),
    ('push', 'push-dip',        'Parallel Bar Dip',   'parallel-bar-dip',   'push-decline',    3,
     '{"kind":"sets_at","exercise":"decline-push-up","sets":3,"reps":12}'),
    ('push', 'push-handstand',  'Handstand Push-Up',  'handstand-push-ups', 'push-dip',        4,
     '{"kind":"sets_at","exercise":"parallel-bar-dip","sets":3,"reps":10}'),

    -- PULL ---------------------------------------------------------------
    ('pull', 'pull-row',        'Inverted Row',       'inverted-row',       null,              0,
     '{}'),
    ('pull', 'pull-assisted',   'Band Assisted Pull-Up', 'band-assisted-pull-up', 'pull-row',  1,
     '{"kind":"sets_at","exercise":"inverted-row","sets":3,"reps":12}'),
    ('pull', 'pull-chin',       'Chin-Up',            'chin-up',            'pull-assisted',   2,
     '{"kind":"sets_at","exercise":"band-assisted-pull-up","sets":3,"reps":8}'),
    ('pull', 'pull-up',         'Pull-Up',            'pullups',            'pull-chin',       3,
     '{"kind":"sets_at","exercise":"chin-up","sets":3,"reps":8}'),
    ('pull', 'pull-weighted',   'Weighted Pull-Up',   'weighted-pull-ups',  'pull-up',         4,
     '{"kind":"sets_at","exercise":"pullups","sets":3,"reps":10}'),
    ('pull', 'pull-muscle-up',  'Muscle-Up',          'muscle-up',          'pull-weighted',   5,
     '{"kind":"sets_at","exercise":"weighted-pull-ups","sets":3,"reps":5,"weight_kg":20}'),

    -- LEGS ---------------------------------------------------------------
    ('legs', 'legs-chair',      'Chair Squat',        'chair-squat',        null,              0,
     '{}'),
    ('legs', 'legs-bodyweight', 'Bodyweight Squat',   'bodyweight-squat',   'legs-chair',      1,
     '{"kind":"sets_at","exercise":"chair-squat","sets":3,"reps":15}'),
    ('legs', 'legs-lunge',      'Walking Lunge',      'bodyweight-walking-lunge', 'legs-bodyweight', 2,
     '{"kind":"sets_at","exercise":"bodyweight-squat","sets":3,"reps":20}'),
    ('legs', 'legs-split',      'Split Squat',        'split-squats',       'legs-lunge',      3,
     '{"kind":"sets_at","exercise":"bodyweight-walking-lunge","sets":3,"reps":16}'),
    ('legs', 'legs-pistol',     'Pistol Squat',       'smith-machine-pistol-squat', 'legs-split', 4,
     '{"kind":"sets_at","exercise":"split-squats","sets":3,"reps":12}'),

    -- CORE ---------------------------------------------------------------
    -- The root is a hold and has no criteria, because there is no duration
    -- column to write one against. See the header.
    ('core', 'core-plank',      'Plank',              'plank',              null,              0,
     '{}'),
    ('core', 'core-leg-raise',  'Lying Leg Raise',    'flat-bench-lying-leg-raise', 'core-plank', 1,
     '{}'),
    ('core', 'core-hanging',    'Hanging Leg Raise',  'hanging-leg-raise',  'core-leg-raise',  2,
     '{"kind":"sets_at","exercise":"flat-bench-lying-leg-raise","sets":3,"reps":15}'),
    ('core', 'core-pike',       'Hanging Pike',       'hanging-pike',       'core-hanging',    3,
     '{"kind":"sets_at","exercise":"hanging-leg-raise","sets":3,"reps":12}')
) as v(tree, slug, name, exercise_slug, parent_slug, level, criteria);

do $$
declare
  lvl int;
begin
  for lvl in 0..(select max(level) from _tree) loop
    insert into public.progression_nodes
      (user_id, tree, slug, name, exercise_id, parent_id, level, unlock_criteria)
    select
      null,
      t.tree,
      t.slug,
      t.name,
      (select e.id from public.exercises e
        where e.slug = t.exercise_slug and e.user_id is null),
      (select p.id from public.progression_nodes p
        where p.slug = t.parent_slug and p.user_id is null),
      t.level,
      t.criteria
    from _tree t
    where t.level = lvl;
  end loop;
end $$;
