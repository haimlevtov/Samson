-- Samson 0037 — stop re-evaluating achievements the user already holds
--
-- FOUND IN REVIEW, 2026-09-08, on the branch that took the system achievement
-- count from one to ten.
--
-- `evaluate_achievements` runs every system predicate on every workout
-- completion, and `award_session_xp` then tries to insert an event for each
-- one that fires, catching `unique_violation` for the ones already held. So a
-- user holding eight of ten badges pays for eight full-history scans per
-- session whose result is discarded, forever, and the cost grows as they earn
-- more. The two most expensive predicates — `hundred-tonnes` sums every set,
-- `twenty-percent-up` groups and array_aggs every set — are exactly the ones
-- earned early and held for life.
--
-- WHY this is behaviour-preserving and not an optimisation with a caveat:
-- `achievement_events_once` — unique (user_id, achievement_id) — already makes
-- a second unlock impossible. When that insert raised, plpgsql's handler ran
-- BEFORE the append to `v_unlocked`, so a held achievement never appeared in
-- the returned array either. Skipping it here produces the same answer by not
-- asking the question.
--
-- Note the argument is about the CONSTRAINT, not about the predicates being
-- monotone. Some are not — `twenty-of-twenty-eight` reads a moving window and
-- a user can fall back below twenty. It still cannot be unlocked twice, so the
-- skip is safe regardless.
--
-- Second effect, smaller but real: each caught `unique_violation` is a plpgsql
-- subtransaction. Ten predicates meant up to ten of them per completion, and
-- Postgres degrades sharply past 64 subtransactions in one transaction
-- (PGPROC subxid cache overflow). This keeps the count proportional to what is
-- NEWLY unlocked rather than to how many badges exist.
--
-- AI-NOTE: this function now answers "which would NEWLY fire", not "which
--          would fire". Nothing else calls it — it is revoked from anon and
--          from authenticated on purpose (exposing it would let a client ask
--          which achievements exist, which is a hidden-definition leak by
--          another route) — but if a second caller ever appears, that is the
--          contract it gets.

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
      -- The predicate is evaluated with the user id bound as a parameter, so a
      -- system predicate is scoped to this user and cannot read across users.
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

-- Grants are re-asserted because CREATE OR REPLACE keeps them, and saying so
-- costs nothing next to discovering it did not — ADR 0003.
--
-- AI-NOTE: still NOT granted to authenticated. Exposing the evaluator would let
--          a client ask which achievements exist, which is a hidden-definition
--          leak by another route — migration 20260902094000.
revoke all on function public.evaluate_achievements(uuid) from public, anon, authenticated;

-- And the same pattern applied to the function added an hour earlier in this
-- branch, which revoked from `public, anon` and relied on the grant below to
-- settle `authenticated`.
--
-- FOUND IN REVIEW: the end state was already correct, but 20260907180100 and
-- 20260907190000 established the wider form for a reason — revoking from all
-- three before granting makes the result independent of whatever a default
-- privilege happened to be, rather than something a reader has to re-derive.
revoke all on function public.unlocked_achievements() from public, anon, authenticated;
grant execute on function public.unlocked_achievements() to authenticated;
