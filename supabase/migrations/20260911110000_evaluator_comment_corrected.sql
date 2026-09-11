-- Samson 0056 — the evaluator's own comment stops claiming a scope it lacks
--
-- FOUND IN REVIEW of PR #43, 2026-09-11. Inside `evaluate_achievements`, as
-- last defined in 20260908090200, a comment said a system predicate "is scoped
-- to this user and cannot read across users". It was false twice — `workouts`
-- (20260908140000) and `exercises` (20260911100000) — and ADR 0009 §3 and the
-- add-achievement skill have been corrected.
--
-- WHY a migration for a comment: a comment inside a function body is part of
-- the stored source, so every database that ran 20260908090200 holds the
-- claim, and the stored source is exactly where the next author of a predicate
-- would read it. Editing 20260908090200 in place would change nothing in a
-- database that has already run it, and leave the repo describing source those
-- databases do not hold. A comment OUTSIDE a function body is not stored in any
-- schema object, which is why 20260824150203's AI-NOTE was amended in place in
-- the same change.
--
-- The body is 20260908090200's, character for character, apart from that
-- comment — checked by comparing the two with each comment removed when this
-- was written — so behaviour does not change, and tests/db/achievements.test.ts
-- covers it as before. CREATE OR REPLACE resets `security definer` and the
-- `search_path` setting unless they are restated, so both are. It keeps grants;
-- they are re-asserted anyway, as 20260908090200 did.
--
-- Like 20260911090000 and 20260911100000, this had not reached hosted when it
-- was written or when review revised its stored comment; it goes by
-- `supabase db push` after the PR merges.

create or replace function public.evaluate_achievements(p_user_id uuid)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_achievement record;
  unlocked boolean;
begin
  for row_achievement in
    select a.id, a.slug, a.predicate
    from public.achievements a
    where a.user_id is null          -- ADR 0009 §3. Do not remove.
      -- Already held. The unique constraint on achievement_events would refuse
      -- the insert anyway; this is refusing to do the work that leads to it.
      and not exists (
        select 1
        from public.achievement_events ev
        where ev.user_id = p_user_id
          and ev.achievement_id = a.id
      )
    order by a.slug
  loop
    begin
      -- AI-NOTE: the user id is bound as $1, and that scopes nothing by
      --          itself. This function is `security definer`, so a predicate
      --          reads every table with RLS off: each one must filter every
      --          user-ownable table it touches to $1 — the table it starts
      --          from, `sets` or `workouts`, AND anything it joins. ADR 0009
      --          §3, amended 2026-09-11; .claude/skills/add-achievement.
      execute format('select (%s)', row_achievement.predicate)
        into unlocked
        using p_user_id;
    exception when others then
      -- A broken predicate must not fail the whole workout-completion path. The
      -- achievement simply does not unlock, and the next migration can fix it.
      unlocked := false;
    end;

    if coalesce(unlocked, false) then
      return next row_achievement.id;
    end if;
  end loop;
end;
$$;

-- AI-NOTE: still NOT granted to authenticated. Exposing the evaluator would let
--          a client ask which achievements exist, which is a hidden-definition
--          leak by another route — migration 20260902094000.
revoke all on function public.evaluate_achievements(uuid) from public, anon, authenticated;
