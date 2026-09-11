-- Samson 0057 — the legs tree starts on the floor
--
-- Decision: docs/adr/0020-progression-unlock-criteria.md, amended 2026-09-11,
-- committed first. Skill: .claude/skills/add-progression/SKILL.md.
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7.
--
-- FOUND IN REVIEW of PR #42. Three of the legs tree's five rungs were lifts the
-- app could not give a bodyweight user, two of them chosen by a name that
-- misleads: `chair-squat` is a Smith-machine squat tagged `machine`, and
-- `split-squats` is a jumping split filed under `stretching`. The third,
-- `smith-machine-pistol-squat`, is honestly named — a pistol under a Smith bar
-- — and tagged `machine`. The picker (`availableExercises`) offers neither
-- `machine` to a bodyweight user nor `stretching` to anyone, so the tree
-- stopped at its root for every bodyweight user and its top rung could never
-- open at all. 20260908120000 checked that each slug existed; that was the
-- wrong question.
--
-- The new ladder, every criterion's lift filed as bodyweight AND programmable,
-- each read against its instructions rather than its name:
--
--   0  Bodyweight Squat         the root, always open
--   1  Walking Lunge            3 x 20 bodyweight squats     (as before)
--   2  Step-Up with Knee Raise  3 x 16 walking lunges        (as before)
--   3  Split Jump               3 x 12 step-ups with knee raise
--
-- WHY delete and re-insert rather than update in place: the rungs change
-- identity, not just content. The root becomes a different lift, a rung moves
-- down a level under a new parent, and two go. Updating five rows into four
-- would keep ids whose meaning had changed. Nothing holds a node id to strand:
--   * `exercise_id` is null on every node by design — 20260908120200;
--   * unlock state is computed from logged sets on every read and never stored;
--   * no user row hangs off a shared legs node. 20260908120100 dropped the
--     write policy, which stopped new user rows but deleted none, and until
--     then any signed-in user could insert one. A read-only check on hosted on
--     2026-09-11 found no user-owned node at all, and the block below raises
--     rather than let the cascade take one.
-- `parent_id` is `on delete cascade`, so deleting the root takes its chain.
--
-- WHY one statement per level: a parent is looked up by slug from this table,
-- and a single INSERT ... SELECT sees the table as it was when the statement
-- started — the trap 20260908120000's loop exists for. A lookup that missed
-- would insert nothing and say nothing, so the block at the end counts.
--
-- AI-NOTE: the lunge rung's 3 x 20 is what the home-gym programme clears with
--          bodyweight squats at 3 x 21 (src/seed/archetypes.ts), and his
--          walking lunges at 3 x 12 fall short of the step-up's 3 x 16 on
--          purpose. Change a number here and check both, and the climb pinned
--          in tests/db/progression.test.ts.

do $$
begin
  if exists (
    select 1
    from public.progression_nodes c
    join public.progression_nodes p on p.id = c.parent_id
    where c.user_id is not null and p.user_id is null and p.tree = 'legs'
  ) then
    raise exception 'a user-owned node hangs off the shared legs tree, and the cascade below would delete it';
  end if;
end $$;

delete from public.progression_nodes where tree = 'legs' and user_id is null;

insert into public.progression_nodes (user_id, tree, slug, name, parent_id, level, unlock_criteria)
values (null, 'legs', 'legs-squat', 'Bodyweight Squat', null, 0, '{}'::jsonb);

insert into public.progression_nodes (user_id, tree, slug, name, parent_id, level, unlock_criteria)
select null::uuid, 'legs', 'legs-lunge', 'Walking Lunge', p.id, 1,
       '{"kind":"sets_at","exercise":"bodyweight-squat","sets":3,"reps":20}'::jsonb
from public.progression_nodes p
where p.slug = 'legs-squat' and p.user_id is null;

insert into public.progression_nodes (user_id, tree, slug, name, parent_id, level, unlock_criteria)
select null::uuid, 'legs', 'legs-step-up', 'Step-Up with Knee Raise', p.id, 2,
       '{"kind":"sets_at","exercise":"bodyweight-walking-lunge","sets":3,"reps":16}'::jsonb
from public.progression_nodes p
where p.slug = 'legs-lunge' and p.user_id is null;

insert into public.progression_nodes (user_id, tree, slug, name, parent_id, level, unlock_criteria)
select null::uuid, 'legs', 'legs-split-jump', 'Split Jump', p.id, 3,
       '{"kind":"sets_at","exercise":"step-up-with-knee-raise","sets":3,"reps":12}'::jsonb
from public.progression_nodes p
where p.slug = 'legs-step-up' and p.user_id is null;

do $$
declare
  n int;
begin
  select count(*) into n
  from public.progression_nodes
  where tree = 'legs' and user_id is null;

  if n <> 4 then
    raise exception 'the legs tree has % nodes after rebuilding it, expected 4', n;
  end if;
end $$;
