-- Samson 0013 — the gamification trust boundary
--
-- Design and reasoning: docs/adr/0009-gamification-trust.md
-- Contract: docs/specs/xp-and-challenges.md
--
-- Phase 0 created xp_events and achievement_events with read-only RLS and no
-- write policy at all, so nothing an authenticated session does can insert into
-- either table. This migration adds the only things that can, and constrains
-- what they are allowed to write.

-- ---------------------------------------------------------------------------
-- 1. The weekly ceiling, as a database guarantee
-- ---------------------------------------------------------------------------

-- INVARIANT: no sequence of sessions can breach the weekly ceiling — PLAN.md
--            phase 4. The TypeScript clamp in src/gamification/xp.ts is the
--            policy; this trigger is the floor under it.
-- WHY duplicate the number: the ceiling is the one figure a bug, a migration or
--      a careless admin script could breach with nothing noticing, and the
--      damage is silent — a user with more XP than the rules allow, discovered
--      whenever someone next looks. The criterion says "no sequence", not "no
--      sequence via the intended path".
-- AI-NOTE: 500 is WEEKLY_XP_CEILING in src/gamification/xp.ts. The two are
--          pinned together by tests/db/gamification.test.ts. Change one and
--          that test tells you about the other.
create or replace function public.enforce_weekly_xp_ceiling()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ceiling constant int := 500;
  spent int;
begin
  select coalesce(sum(amount), 0) into spent
  from public.xp_events
  where user_id = new.user_id and week_start = new.week_start;

  if spent + new.amount > ceiling then
    raise exception
      'weekly XP ceiling exceeded: % already awarded for week %, refusing % more (ceiling %)',
      spent, new.week_start, new.amount, ceiling
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- Idempotent so the migration can be replayed against a database that
-- already has it, which is what tests/db and a local reset both do.
drop trigger if exists xp_events_ceiling on public.xp_events;
create trigger xp_events_ceiling
  before insert on public.xp_events
  for each row execute function public.enforce_weekly_xp_ceiling();

-- ---------------------------------------------------------------------------
-- 2. Achievement evaluation — system-owned predicates only
-- ---------------------------------------------------------------------------

-- INVARIANT: predicates execute only for system-owned rows — ADR 0009 §3.
--
-- WHY this is a security control and not a tidiness preference:
-- `achievements.predicate` is SQL text stored in a table, and the phase 0
-- policy `achievements_write` lets any authenticated user insert their OWN
-- achievement row. A loop that executed every predicate inside this
-- SECURITY DEFINER function would run user-authored SQL with the definer's
-- privileges — a privilege escalation open to anyone who can sign up.
--
-- `user_id is null` is what separates content the server RUNS from content the
-- user merely OWNS. Removing that clause reopens the hole.
--
-- AI-NOTE: tests/db/gamification.test.ts inserts a user-owned achievement whose
--          predicate would be observable if executed, and asserts it never
--          runs. If you change this query, that test is the one that fails.
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
    select id, slug, predicate
    from public.achievements
    where user_id is null          -- ADR 0009 §3. Do not remove.
    order by slug
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

-- ---------------------------------------------------------------------------
-- 3. The only path that writes XP
-- ---------------------------------------------------------------------------

-- INVARIANT: no completion can be granted from the client — PLAN.md phase 4.
--
-- WHY there is no p_amount parameter: an RPC that accepted an amount would move
-- the trust boundary into the browser, however carefully the caller behaved.
-- This function takes a workout id and derives everything else from rows that
-- are already in the database.
create or replace function public.award_session_xp(p_workout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_local_date date;
  v_week_start date;
  v_nth int;
  v_amount int;
  v_spent int;
  v_granted int := 0;
  v_achievement uuid;
  v_unlocked jsonb := '[]'::jsonb;
  ceiling constant int := 500;
begin
  -- The workout must exist, must be completed, and must belong to the caller.
  -- auth.uid() rather than a parameter: the caller does not get to say who they
  -- are.
  select w.user_id, w.local_date
    into v_user_id, v_local_date
  from public.workouts w
  where w.id = p_workout_id
    and w.user_id = auth.uid()
    and w.status = 'completed';

  if v_user_id is null then
    return jsonb_build_object('awarded', 0, 'unlocked', '[]'::jsonb);
  end if;

  -- INVARIANT: the user's local date, never a server date — CLAUDE.md #9.
  -- The workout carries the date it was logged on; week_start is derived from
  -- that and stored, so a user who travels cannot reopen a spent ceiling.
  v_week_start := date_trunc('week', v_local_date)::date;

  -- Position of this session within its week, counting kept days only. Matches
  -- weeklyAwards() in src/gamification/xp.ts: 'rest' counts, unresolved does not.
  select count(*) into v_nth
  from public.workouts w
  where w.user_id = v_user_id
    and w.status in ('completed', 'rest')
    and date_trunc('week', w.local_date)::date = v_week_start;

  -- sessionXp(n) = round(100 * 0.8^(n-1)) — the curve in the spec.
  v_amount := round(100 * power(0.8, greatest(v_nth, 1) - 1));

  select coalesce(sum(amount), 0) into v_spent
  from public.xp_events
  where user_id = v_user_id and week_start = v_week_start;

  -- The same clamp the application applies, so the trigger below never has to
  -- fire in normal operation.
  v_amount := greatest(0, least(v_amount, ceiling - v_spent));

  if v_amount > 0 then
    insert into public.xp_events (user_id, source, amount, local_date, week_start)
    values (v_user_id, 'adherence', v_amount, v_local_date, v_week_start);
    v_granted := v_amount;
    v_spent := v_spent + v_amount;
  end if;

  -- Achievements. The unique constraint on achievement_events is what makes
  -- "fires exactly once" a database guarantee rather than a property of this
  -- function, so a re-run inserts nothing and reports nothing new.
  for v_achievement in select * from public.evaluate_achievements(v_user_id) loop
    begin
      insert into public.achievement_events (user_id, achievement_id, local_date)
      values (v_user_id, v_achievement, v_local_date);

      v_unlocked := v_unlocked || to_jsonb(
        (select a.slug from public.achievements a where a.id = v_achievement)
      );

      -- Achievement XP, still under the ceiling.
      v_amount := greatest(0, least(75, ceiling - v_spent));
      if v_amount > 0 then
        insert into public.xp_events (user_id, source, amount, local_date, week_start)
        values (v_user_id, 'achievement', v_amount, v_local_date, v_week_start);
        v_granted := v_granted + v_amount;
        v_spent := v_spent + v_amount;
      end if;
    exception when unique_violation then
      -- Already held. Not an error, and not re-reported to the UI.
      null;
    end;
  end loop;

  return jsonb_build_object('awarded', v_granted, 'unlocked', v_unlocked);
end;
$$;

-- The RPCs are callable by a signed-in user; the anon role gets nothing.
-- INVARIANT: RLS and grants are two independent gates — ADR 0003.
revoke all on function public.award_session_xp(uuid) from public, anon;
revoke all on function public.evaluate_achievements(uuid) from public, anon;
grant execute on function public.award_session_xp(uuid) to authenticated;

-- NOT granted to authenticated: evaluate_achievements is an internal helper of
-- award_session_xp. Exposing it would let a client ask "which achievements
-- would fire", which is a hidden-achievement leak by another route.
