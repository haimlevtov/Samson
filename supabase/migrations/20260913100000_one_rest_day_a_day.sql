-- Samson 0076 — one rest day a day
--
-- ADR 0034, committed first. The Workout tab now logs today as a rest day, the
-- first application path to write `workouts.status = 'rest'` — 20260902100000
-- recorded that none existed.
--
-- WHY an index and not the action's own check: the action reads the day and then
-- writes, so a double press races it, and `workouts_own` is `for all`, so the
-- API does not pass through the action at all. A rest day costs nothing to log;
-- without this, ten presses are ten rest days — `ten-rest-days` in a minute, and
-- the week walked down the XP curve to its ceiling. `insertRestDay` in
-- src/db/training.ts names this index and treats its violation as "already a
-- rest day".
--
-- Partial, on purpose: a session on a rest day is allowed (ADR 0034 §4), and two
-- sessions in a day always were.
--
-- Checked on hosted before this migration: no user has two rest rows on one date,
-- so it builds without a cleanup.

create unique index workouts_one_rest_a_day
  on public.workouts (user_id, local_date)
  where status = 'rest';

-- The catalogue card says where, now that there is a where — ADR 0034 §8.
-- Fails loudly rather than updating nothing, as 20260912250100 does.
do $$
declare
  updated int;
begin
  update public.achievements
     set how_to_earn = 'Log ten rest days, one a day, with Rest today on the Workout tab.'
   where slug = 'ten-rest-days'
     and user_id is null;
  get diagnostics updated = row_count;
  if updated <> 1 then
    raise exception 'expected one shared ten-rest-days row, updated %', updated;
  end if;
end $$;
