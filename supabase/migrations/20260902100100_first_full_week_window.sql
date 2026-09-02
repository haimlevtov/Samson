-- Samson 0023 — anchor first-full-week to the user's latest KEPT day
--
-- FOUND IN REVIEW, 2026-09-02. The predicate written in 20260902090100 anchors
-- its seven-day window to `max(local_date)` over ALL of the user's workout rows
-- with no status filter, while the counting query filters to
-- ('completed', 'rest'). The comment above it claims it uses "the user's own
-- latest logged date"; what it actually used was the latest row of any kind.
--
-- One unkept row is enough to suppress the achievement permanently, and the
-- window only ever moves further forward:
--
--   Keep 2026-09-01..09-07, then skip the 8th and train on the 9th. max()
--   becomes 09-09, the window is (09-02, 09-09], and the kept distinct dates
--   inside it number six. Seven were kept in a row and nothing unlocks.
--
-- Any `planned` row the planner writes ahead of today does the same thing, and
-- that is the normal case once phase 2's planner is scheduling sessions — a
-- future-dated row would push the window past every day the user has trained.
--
-- WHY the anchor stays relative and does not become current_date: unchanged
-- from the original reasoning, and still right. A server-date window evaluates
-- on the wrong day for every user outside the server's timezone (CLAUDE.md #9).
-- Anchoring to the user's own history removes the clock from the predicate, so
-- the same history always yields the same answer. The bug was never the anchor
-- being relative; it was the anchor being measured over different rows than the
-- count.
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7. This is
--            an UPDATE to a row, not an edit to the migration that inserted it:
--            20260902090100 is applied to the hosted project, and the trail is
--            meant to show what was believed, then what was found.
--
-- AI-NOTE: tests/db/gamification.test.ts covers both the unlock and the
--          near-miss that used to break it — a stray unkept row after a full
--          week. Changing this predicate fails those.

update public.achievements
set predicate = $pred$
    (select count(distinct w.local_date) >= 7
     from public.workouts w
     where w.user_id = $1
       and w.status in ('completed', 'rest')
       and w.local_date > (
         select max(w2.local_date) - 7
         from public.workouts w2
         where w2.user_id = $1
           and w2.status in ('completed', 'rest')
       ))
  $pred$
where slug = 'first-full-week'
  and user_id is null;
