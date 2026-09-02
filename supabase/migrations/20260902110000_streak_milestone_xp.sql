-- Samson 0026 — pay the streak milestones the engine already computes
--
-- Contract: docs/specs/xp-and-challenges.md
--
-- Gap recorded in docs/plans/phase-4.md: `streakAwards()` exists in
-- src/gamification/xp.ts, is covered by a property test, and has no caller.
-- `xp_events.source` has accepted 'streak' since phase 0. PLAN.md phase 4 lists
-- "streaks counting planned days, so scheduled rest maintains them" as a build
-- item, and half of it shipped — the streak is counted and displayed, and
-- crossing a milestone pays nothing.
--
-- AI-NOTE: this duplicates `currentStreak()` in src/metrics/adherence.ts and
--          STREAK_MILESTONES / STREAK_MILESTONE_XP in src/gamification/xp.ts.
--          That is a second definition of a rule, which this codebase otherwise
--          avoids — it is accepted here for the same reason the weekly ceiling
--          is duplicated (ADR 0009 §2): XP can only be written by a definer
--          function, so anything that awards it has to be able to derive it.
--          tests/db/gamification.test.ts pins the two definitions together,
--          including the awkward case below. If you change either, that test is
--          the one that fails.
--
-- WHY the streak counts ROWS and not calendar days: a day with no scheduled
-- session is neither kept nor broken, so an every-other-day programme does not
-- reset on its off days. That is `currentStreak`'s documented behaviour and its
-- "skips over days with nothing scheduled" test, and this query reproduces it
-- exactly rather than substituting the more obvious calendar-day reading.

-- INVARIANT: one streak award per workout — the same reasoning as
--            xp_events_one_adherence_per_workout (20260902095100). At most one
--            milestone can be crossed by a single session, because the streak
--            before it is always exactly one less.
create unique index if not exists xp_events_one_streak_per_workout
  on public.xp_events (workout_id)
  where source = 'streak' and workout_id is not null;

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
  v_streak int;
  v_achievement uuid;
  v_unlocked jsonb := '[]'::jsonb;
  ceiling constant int := 500;
  milestones constant int[] := array[7, 14, 30, 60, 100];
  milestone_xp constant int := 50;
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
      insert into public.xp_events (user_id, source, amount, local_date, week_start, workout_id)
      values (v_user_id, 'adherence', v_amount, v_local_date, v_week_start, p_workout_id);
      v_granted := v_amount;
      v_spent := v_spent + v_amount;
    exception when unique_violation then
      null;
    end;
  end if;

  /*
   * The streak ending at this workout's date: resolved rows walked backwards
   * from the most recent, stopping at the first that was not kept. Rows, not
   * dates — see the WHY above.
   */
  with resolved as (
    select w.status,
           row_number() over (order by w.local_date desc, w.id desc) as rn
    from public.workouts w
    where w.user_id = v_user_id
      and w.status in ('completed', 'rest', 'skipped')
      and w.local_date <= v_local_date
  )
  select coalesce(
           (select min(rn) from resolved where status not in ('completed', 'rest')),
           (select count(*) from resolved) + 1
         ) - 1
    into v_streak;

  if v_streak = any (milestones) then
    v_amount := greatest(0, least(milestone_xp, ceiling - v_spent));
    if v_amount > 0 then
      begin
        insert into public.xp_events (user_id, source, amount, local_date, week_start, workout_id)
        values (v_user_id, 'streak', v_amount, v_local_date, v_week_start, p_workout_id);
        v_granted := v_granted + v_amount;
        v_spent := v_spent + v_amount;
      exception when unique_violation then
        null;
      end;
    end if;
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
