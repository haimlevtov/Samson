-- Samson 0022 — a rest day earns what a training day earns
--
-- FOUND IN REVIEW, 2026-09-02. award_session_xp required
-- `w.status = 'completed'` to award anything, but counted
-- `status in ('completed', 'rest')` when working out the session's position in
-- the week. A rest day therefore paid nothing AND pushed every later session
-- that week further down the diminishing curve.
--
-- Rest Monday + completed Tuesday earned 0 + 80 = 80, where weeklyAwards() in
-- src/gamification/xp.ts pays 100 + 80 = 180 for the same week: it sorts the
-- week's kept workouts by date and pays sessionXp(position), so rest takes
-- position 1 and earns what a training day in position 1 earns. "Neutral" means
-- identical AT THE SAME POSITION — a rest day still consumes a place on the
-- diminishing curve, which is correct and is not the bug. The bug is that it
-- consumed one while paying nothing. Two things were wrong at once:
--
--   - It contradicts the spec's stated property, "Rest is neutral: a rest day
--     and a completed day earn identically at the same position"
--     (docs/specs/xp-and-challenges.md), and CLAUDE.md #4, "Rest days maintain
--     streaks". Resting cost the user XP, which is the precise behaviour
--     invariant #4 exists to prevent.
--   - The database and the offline engine disagreed about the same week. The
--     engine is the policy and the database is the floor (ADR 0009); a floor
--     that computes a different number is not a floor.
--
-- It also meant evaluate_achievements never ran on a rest day, so an
-- achievement whose seventh day is a rest day could not fire on the day it was
-- earned. See 20260902100100, which is the other half of that.
--
-- AI-NOTE: the status list here and EARNS in src/gamification/xp.ts are the
--          same rule. They are pinned together by tests/db/gamification.test.ts.
--
-- Still absent, and deliberately not invented here: nothing in the application
-- creates a 'rest' workout or calls this RPC for one — only scripts/seed.ts
-- produces them. Giving the user a way to log a rest day is a UI decision for
-- the phase that adds it, not something to smuggle into a migration.

create or replace function public.award_session_xp(p_workout_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
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
  -- 'rest' earns exactly as 'completed' does. 'planned' and 'in_progress' have
  -- not resolved and earn nothing; 'skipped' resolved as not kept.
  select w.user_id, w.local_date
    into v_user_id, v_local_date
  from public.workouts w
  where w.id = p_workout_id
    and w.user_id = auth.uid()
    and w.status in ('completed', 'rest');

  if v_user_id is null then
    return jsonb_build_object('awarded', 0, 'unlocked', '[]'::jsonb);
  end if;

  v_week_start := date_trunc('week', v_local_date)::date;

  -- Everything below reads the week, decides against it, and writes to it — see
  -- 20260902095200. Same key as the ceiling trigger, and re-entrant.
  perform pg_advisory_xact_lock(
    hashtextextended(v_user_id::text || ':' || v_week_start::text, 0)
  );

  select count(*) into v_nth
  from public.workouts w
  where w.user_id = v_user_id
    and w.status in ('completed', 'rest')
    and date_trunc('week', w.local_date)::date = v_week_start;

  v_amount := round(100 * power(0.8, greatest(v_nth, 1) - 1));

  select coalesce(sum(amount), 0) into v_spent
  from public.xp_events
  where user_id = v_user_id and week_start = v_week_start;

  v_amount := greatest(0, least(v_amount, ceiling - v_spent));

  if v_amount > 0 then
    begin
      -- AI-NOTE: the guarantee is xp_events_one_adherence_per_workout
      --          (20260902095100), not this handler.
      insert into public.xp_events (user_id, source, amount, local_date, week_start, workout_id)
      values (v_user_id, 'adherence', v_amount, v_local_date, v_week_start, p_workout_id);
      v_granted := v_amount;
      v_spent := v_spent + v_amount;
    exception when unique_violation then
      null;
    end;
  end if;

  for v_achievement in select * from public.evaluate_achievements(v_user_id) loop
    begin
      insert into public.achievement_events (user_id, achievement_id, local_date)
      values (v_user_id, v_achievement, v_local_date);

      v_unlocked := v_unlocked || to_jsonb(
        (select a.slug from public.achievements a where a.id = v_achievement)
      );

      v_amount := greatest(0, least(75, ceiling - v_spent));
      if v_amount > 0 then
        insert into public.xp_events (user_id, source, amount, local_date, week_start, workout_id)
        values (v_user_id, 'achievement', v_amount, v_local_date, v_week_start, p_workout_id);
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
$fn$;

revoke all on function public.award_session_xp(uuid) from public, anon;
grant execute on function public.award_session_xp(uuid) to authenticated;
