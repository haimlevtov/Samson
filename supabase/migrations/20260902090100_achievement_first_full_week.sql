-- Samson 0014 — the first achievement
--
-- Added per .claude/skills/add-achievement/SKILL.md: the row, the predicate,
-- the humor tier, and the tests, all in the same change.
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7. This is
--            a migration and not an application change, which is the whole
--            point of storing the predicate as a row.

insert into public.achievements (user_id, slug, name, description, predicate, tier, humor_level, hidden, source_hint)
values (
  -- System-owned. ADR 0009 §3: only user_id null rows are ever executed.
  null,
  'first-full-week',
  'Seven for Seven',
  'Seven days, seven kept. Rest days counted — that was the point.',

  -- INVARIANT: XP and unlocks derive from adherence, never volume — CLAUDE.md #4.
  --            This predicate deliberately does not look at weight or reps. An
  --            achievement that rewarded tonnage would pay people to overtrain
  --            just as surely as XP would.
  --
  -- WHY it uses the user's own latest logged date rather than current_date: a
  -- server-date window silently evaluates on the wrong day for every user
  -- outside the server's timezone — CLAUDE.md #9. Anchoring to the user's own
  -- most recent logged day removes the clock from the predicate entirely, so
  -- the same history always yields the same answer.
  --
  -- $1 is the user id, bound as a parameter by evaluate_achievements().
  $pred$
    (select count(distinct w.local_date) >= 7
     from public.workouts w
     where w.user_id = $1
       and w.status in ('completed', 'rest')
       and w.local_date > (
         select max(w2.local_date) - 7
         from public.workouts w2
         where w2.user_id = $1
       ))
  $pred$,

  'consistency',
  'clean',
  false,
  null
);
