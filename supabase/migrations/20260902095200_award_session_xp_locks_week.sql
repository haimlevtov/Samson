-- Samson 0021 — award_session_xp serialises the week it is spending
--
-- Pairs with 20260902095000, which put the same lock under the ceiling trigger.
-- This is the half that makes the intended path CLAMP correctly rather than
-- merely fail safely.
--
-- The trigger alone is enough to stop the ceiling being breached, but not
-- enough to keep the RPC well-behaved: two concurrent calls both read the same
-- `v_spent`, both compute a full award, and the second one reaches a trigger
-- that now refuses it — so the caller gets an exception where the rules say it
-- should have been clamped to whatever was left. `finishWorkout` swallows that
-- exception, which turns a race into a silently lost award.
--
-- Taking the lock before the read closes the window: the second call reads the
-- first call's committed total, clamps against it, and awards the remainder.
--
-- WHY an advisory lock and not SELECT ... FOR UPDATE: the thing being protected
-- is the absence of rows as much as their presence — a week with nothing spent
-- has nothing to lock. The key is (user, week), the same bucket the ceiling is
-- enforced against, so unrelated users never wait on each other.
--
-- Unchanged here, and still open: a 'rest' workout earns nothing through this
-- function while still counting toward v_nth, so a rest day both pays zero and
-- discounts the sessions after it. That is a separate defect in the curve, not
-- in the trust boundary, and it needs the spec's "rest is neutral" property
-- decided before the arithmetic moves.

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
  select w.user_id, w.local_date
    into v_user_id, v_local_date
  from public.workouts w
  where w.id = p_workout_id
    and w.user_id = auth.uid()
    and w.status = 'completed';

  if v_user_id is null then
    return jsonb_build_object('awarded', 0, 'unlocked', '[]'::jsonb);
  end if;

  v_week_start := date_trunc('week', v_local_date)::date;

  -- Everything below reads the week, decides against it, and writes to it. The
  -- lock is taken before the first read so that sequence is atomic against
  -- another call for the same user and week. Same key as the ceiling trigger,
  -- and re-entrant, so the trigger's own lock is free.
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
      --          (20260902095100), not this handler. The handler only turns a
      --          repeat call into a quiet no-op instead of an error.
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
