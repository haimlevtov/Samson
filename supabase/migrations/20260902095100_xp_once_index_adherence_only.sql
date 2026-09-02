-- Samson 0020 — narrow the once-per-workout index to the award it guards
--
-- FOUND IN REVIEW, 2026-09-02, reading the fix in 20260902093000. That index is
-- keyed on (workout_id, source), which covers 'achievement' rows as well as
-- 'adherence' ones. A workout that unlocks TWO achievements writes two rows
-- with the same (workout_id, 'achievement') and the second one collides.
--
-- WHY that is worse than a rejected insert: in award_session_xp the XP insert
-- sits inside the same block as the achievement_events insert, after the slug
-- has been appended to the returned `unlocked` array. plpgsql rolls back the
-- database work of a block when its exception handler runs, but NOT the local
-- variables — so the second achievement would be reported to the UI as unlocked
-- while its achievement_events row was rolled back. The badge fires once and
-- the achievement is never recorded, and the same thing happens again on the
-- next session that unlocks two.
--
-- It is latent rather than live: 20260902090100 ships the only system
-- achievement, so nothing unlocks two in one session yet. The next one added
-- through .claude/skills/add-achievement makes it reachable.
--
-- WHY narrowing loses nothing: achievement XP is already awarded exactly once
-- per achievement, and not by this index. `achievement_events_once` — unique
-- (user_id, achievement_id), 20260824150248 — is what makes it once, and the
-- XP insert only runs on the path where that insert has just succeeded. The
-- adherence award is the one with no other guarantee behind it, and it is the
-- one the replay bug was about.
--
-- AI-NOTE: award_session_xp relies on this index to make a repeat call a
--          no-op. If you widen it again, re-read the paragraph above first.

drop index if exists public.xp_events_once_per_workout_source;

create unique index if not exists xp_events_one_adherence_per_workout
  on public.xp_events (workout_id)
  where source = 'adherence' and workout_id is not null;

comment on column public.xp_events.workout_id is
  'The workout that earned this XP, where one did. At most one adherence award per workout — see migration 20260902095100.';
