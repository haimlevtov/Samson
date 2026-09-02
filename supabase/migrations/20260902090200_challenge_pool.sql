-- Samson 0015 — the starting challenge pool
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7.
--
-- A NULL user_id is an unassigned pool template, per the comment on the
-- `challenges` table. `scripts/generate-challenges.ts` validates candidates
-- against each user and assigns from what survives; these are the seeds it
-- draws from.
--
-- AI-NOTE: `spec` is validated by challengeSpecSchema in
--          src/gamification/challenge.ts, on read as well as on write. A row
--          added here that the schema rejects is skipped by the generator, not
--          crashed on — but it also never reaches a user, so keep it valid.

insert into public.challenges (user_id, slug, kind, spec, status)
values
  -- Daily quests. window_days is 1 for every one of them: a daily quest whose
  -- window is not a day is rejected by validateCandidate as window_mismatch.
  (null, 'daily-one-session', 'daily',
   '{"kind":"sessions","target":1,"window_days":1,"reward_xp":25,"rpe_at_least":null}'::jsonb,
   'offered'),

  (null, 'daily-three-movements', 'daily',
   '{"kind":"distinct_exercises","target":3,"window_days":1,"reward_xp":30,"rpe_at_least":null}'::jsonb,
   'offered'),

  (null, 'daily-two-hard-sets', 'daily',
   '{"kind":"sets_at_rpe","target":2,"window_days":1,"reward_xp":35,"rpe_at_least":8}'::jsonb,
   'offered'),

  -- Weekly challenges.
  (null, 'weekly-three-sessions', 'weekly',
   '{"kind":"sessions","target":3,"window_days":7,"reward_xp":80,"rpe_at_least":null}'::jsonb,
   'offered'),

  (null, 'weekly-five-movements', 'weekly',
   '{"kind":"distinct_exercises","target":5,"window_days":7,"reward_xp":90,"rpe_at_least":null}'::jsonb,
   'offered'),

  (null, 'weekly-keep-the-streak', 'weekly',
   '{"kind":"streak_days","target":5,"window_days":7,"reward_xp":100,"rpe_at_least":null}'::jsonb,
   'offered'),

  (null, 'weekly-eight-hard-sets', 'weekly',
   '{"kind":"sets_at_rpe","target":8,"window_days":7,"reward_xp":110,"rpe_at_least":8}'::jsonb,
   'offered');
