-- Samson 0053 — a second rung on the challenge pool
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7.
--
-- WHY, measured rather than assumed: `validateCandidate` rejects any candidate
-- the user already meets as `below_current_ability`, which is correct — a
-- challenge you already satisfy without changing anything is a free reward. The
-- consequence nobody had checked is that 20260902090200's seven rows are ALL
-- calibrated at or below a consistent lifter's rolling week. Run against the
-- five seeded archetypes, three of them (`beginner`, `plateaued`, `home-gym`)
-- were offered NOTHING: seven candidates, seven rejections, all under that one
-- code.
--
-- So the pool had one rung per kind rather than a ladder. These four clear the
-- top archetype's week. The numbers are the MAXIMUM `evaluateChallenge`
-- returns across 28 consecutive seed dates x 5 archetypes — not one date's
-- reading, which is how an earlier version of this comment came to say 20 for
-- the weekly hard sets when the real peak is 23:
--
--   sessions/week     4    target 5
--   sets_at_rpe/week  23   target 25
--   distinct/day      4    target 6
--   sets_at_rpe/day   5    target 6
--
-- Across those 28 dates none of the four is ever rejected for any archetype.
-- The sweep matters because the seed can run on any day and `generateHistory`
-- drops scheduled days by `chance(rng, adherence)`, so BOTH the daily and the
-- weekly figures move with the date — see tests/db/challenges.test.ts, which
-- runs the same sweep rather than leaving this comment as the only record.
--
-- AI-NOTE: there is no second rung for `streak_days`, and one cannot be added.
--          `maxAchievable` bounds it by `window_days`, the schema caps that at
--          14, and progress is `min(currentStreak, window_days)` — so a user
--          whose streak has reached a fortnight already meets every legal
--          streak challenge. Three archetypes are at 51, 21 and 16 days,
--          because a rest day keeps a streak (CLAUDE.md #4). See
--          docs/specs/xp-and-challenges.md, "The pool is a ladder, not a list".

insert into public.challenges (user_id, slug, kind, spec, status)
values
  -- Daily quests for a day someone is already training. Both sit above the
  -- busiest single session any archetype logs — six movements against four,
  -- six hard sets against five — so they stay offerable on a training day and
  -- are trivially offerable on a rest day.
  (null, 'daily-six-movements', 'daily',
   '{"kind":"distinct_exercises","target":6,"window_days":1,"reward_xp":45,"rpe_at_least":null}'::jsonb,
   'offered'),

  (null, 'daily-six-hard-sets', 'daily',
   '{"kind":"sets_at_rpe","target":6,"window_days":1,"reward_xp":50,"rpe_at_least":8}'::jsonb,
   'offered'),

  -- Weekly. `sessions` counts DAYS, so 5 is within the 7-day bound
  -- `maxAchievable` enforces and above every archetype's fixed rotation.
  (null, 'weekly-five-sessions', 'weekly',
   '{"kind":"sessions","target":5,"window_days":7,"reward_xp":120,"rpe_at_least":null}'::jsonb,
   'offered'),

  -- `sets_at_rpe` is the one kind with no ceiling — a day holds any number of
  -- sets — so this is the rung that stays offerable to the strongest user the
  -- demo has. 140 is inside the 10..150 band; the weekly XP ceiling of 500 is a
  -- separate clamp applied at settlement.
  (null, 'weekly-twenty-five-hard-sets', 'weekly',
   '{"kind":"sets_at_rpe","target":25,"window_days":7,"reward_xp":140,"rpe_at_least":8}'::jsonb,
   'offered');
