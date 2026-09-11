-- Samson 0055 — a set and a template item may only use an exercise the user may see
--
-- FOUND IN REVIEW of PR #43, 2026-09-11, by two reviewers independently. It
-- corrects that PR's own ADR amendment, which first called this column "an
-- existence oracle, no cross-user read today" — wrong on the second half.
--
-- THE READ. `five-patterns`, as last defined in 20260908090400, is
--
--   select count(distinct e.movement_pattern) >= 5
--   from public.sets s join public.exercises e on e.id = s.exercise_id
--   where s.user_id = $1 ...
--
-- and it runs inside `evaluate_achievements`, which is `security definer` on
-- tables with no FORCE row level security. `s` is scoped to the user; `e` is
-- not. `sets_own` never checked `exercise_id`, so alice could log a set against
-- bob's custom exercise and read its movement pattern off whether the badge
-- fired: four known patterns of her own, one set on his, award, repeat. The
-- mechanism of `sets.workout_id` in 20260908140000, one column along — and ADR
-- 0009 §3's "even a system predicate cannot read across users" false a second
-- time for the same reason.
--
-- It needs bob's exercise uuid, which no screen shows, and a custom exercise can
-- only be made through a raw PostgREST call today. That is a fact about today's
-- surfaces, not about the boundary — 20260908140000's phrase, and the reason it
-- was fixed anyway.
--
-- THE OTHER HARM. Both `exercise_id` columns are `on delete restrict`, so a row
-- of alice's pointing at bob's custom exercise stops bob deleting it — and,
-- through the users -> exercises cascade, stops his account being deleted.
--
-- REPRODUCED on hosted before this was written, with throwaway users, by the
-- new cases in tests/db/rls.test.ts and tests/db/achievements.test.ts. alice
-- logged a set against bob's custom exercise and prescribed it in her own
-- template, and both were ACCEPTED. The predicate case failed as
-- "expected [ 'five-patterns' ] to not include 'five-patterns'": a stranger's
-- custom exercise supplied the fifth pattern and the badge fired. The positive
-- control, alice using her own exercise and the catalogue, passed in the same
-- run, and the run left nothing behind.
--
-- AUDITED on hosted before writing this, read-only: no custom exercise exists
-- there at all, so no set or template item points across the boundary and
-- nothing is stranded by the tighter check.
--
-- THE FIX, in two layers, as in 20260908140000.
--
-- 1. The policies. `with check` on `sets_own` and `workout_template_items_own`
--    now also requires the exercise to be one the writer may use — their own,
--    or a shared catalogue row with a null `user_id` — mirroring `exercises_read`
--    exactly. `alter policy` replaces the whole expression, so each one keeps
--    the check it already had: the workout (20260908140000) and the template
--    (20260911090000). Every column reference is qualified with its table, so a
--    column added to `workouts`, `workout_templates` or `exercises` later cannot
--    capture an unqualified name. `using` is untouched, for the reason both
--    earlier fixes give. Policy only: no DDL, and src/db/types.ts does not change.
--
-- 2. The predicate. The join is filtered to the evaluating user's own or shared
--    exercises, so it stays user-scoped if a policy is ever loosened, and a row
--    written before this migration cannot feed it.
--
-- AI-NOTE: three columns of this class are still unchecked, pinned in
--          tests/db/schema-invariants.test.ts: the two on exercise_equipment,
--          whose primary key has no user_id (a key change, not a policy), and
--          user_equipment.equipment_tag_id. ADR 0003's 2026-09-11 amendment has
--          the rule; docs/plans/README.md tracks them.

alter policy sets_own on public.sets
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.workouts w
      where w.id = sets.workout_id
        and w.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.exercises e
      where e.id = sets.exercise_id
        and (e.user_id is null or e.user_id = auth.uid())
    )
  );

alter policy workout_template_items_own on public.workout_template_items
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.workout_templates t
      where t.id = workout_template_items.template_id
        and t.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.exercises e
      where e.id = workout_template_items.exercise_id
        and (e.user_id is null or e.user_id = auth.uid())
    )
  );

-- five-patterns — the join, now scoped. Otherwise identical to 20260908090400.
update public.achievements
set predicate = $fix$
      (select count(distinct e.movement_pattern) >= 5
       from public.sets s
       join public.exercises e
         on e.id = s.exercise_id and (e.user_id is null or e.user_id = $1)
       where s.user_id = $1
         and s.is_warmup = false
         and e.movement_pattern is not null
         and (s.weight_kg is null or s.weight_kg <= 500)
         and (s.reps is null or s.reps <= 100))
$fix$
where slug = 'five-patterns' and user_id is null;
