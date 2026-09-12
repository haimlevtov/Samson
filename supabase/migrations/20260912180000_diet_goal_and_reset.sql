-- Samson 0066 — the diet goal gets somewhere to live
--
-- ADR 0032 §3. The Coach tab has had a goal selector since the diet stage
-- shipped, and its value survives exactly one request: ask for a target, close
-- the tab, come back, and it is `maintain` again. Nothing was wrong with that
-- while the only way in was a form that carried the answer with it. Onboarding
-- cannot ask a question it has nowhere to put the answer to.

alter table public.users
  add column diet_goal text;

-- The same three values `DIET_GOALS` holds in src/diet/energy.ts, which is the
-- source of truth for the vocabulary. Two copies of one fact, the way
-- `llm_calls.stage` is — and like that one, the copy in the database is what a
-- hand-written POST is held to.
alter table public.users
  add constraint users_diet_goal_check
  check (diet_goal is null or diet_goal in ('cut', 'maintain', 'gain'));

-- WHY nullable rather than `default 'maintain'`: "has not said" and "said
-- maintain" are different, and only the first one should make a surface ask.
-- Every reader already falls back — `normaliseGoal` lands on maintain for
-- anything it does not recognise, null included — so nothing changes behaviour
-- by this column existing.
--
-- AI-NOTE: do not add a default later to "tidy" this. The null is the feature:
--          it is what lets onboarding know the question is still open, and what
--          lets the diet block say which answer it is working from.
comment on column public.users.diet_goal is
  'ADR 0032 §3. Null means the user has not chosen; readers fall back to maintain.';
