-- Samson 0017 — make award_session_xp idempotent per workout
--
-- Pairs with 20260902093000, which added the column and the unique index. This
-- is the function change that uses them.
--
-- The bug, measured before the fix: calling award_session_xp twice for the same
-- completed workout returned {"awarded": 64} both times. Achievements were
-- already safe, because achievement_events carries unique (user_id,
-- achievement_id) — the XP insert had no equivalent.
--
-- AI-NOTE: the `exception when unique_violation` below is NOT the guarantee. The
--          unique index is. This block only turns a repeat call into a quiet
--          no-op instead of an error the finish-workout path would have to
--          handle.

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
      null;
    end;
  end loop;

  return jsonb_build_object('awarded', v_granted, 'unlocked', v_unlocked);
end;
$fn$;

revoke all on function public.award_session_xp(uuid) from public, anon;
grant execute on function public.award_session_xp(uuid) to authenticated;
