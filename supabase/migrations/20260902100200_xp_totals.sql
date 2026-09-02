-- Samson 0024 — sum XP in Postgres, not in the browser's server action
--
-- FOUND IN REVIEW, 2026-09-02. `loadXpSummary` in src/db/gamification.ts issued
-- `select amount from xp_events` with no aggregate, no filter and no limit, and
-- added the rows up in JavaScript. PostgREST caps a response at 1000 rows by
-- default, so once a user accumulates more events than that, lifetime XP is the
-- sum of the first page — silently, with no error, and wrong by more every week.
--
-- The file's own header says "Aggregation that Postgres does better (a sum over
-- a week) is done in the query". This is that, made true.
--
-- WHY security invoker and no user id parameter: RLS on xp_events already
-- scopes SELECT to the caller (CLAUDE.md #10), so an invoker-rights function
-- sees exactly the caller's rows and there is no user_id filter for a caller to
-- forget or to get wrong. A definer function here would have to re-implement
-- the scoping that RLS is already doing correctly.
--
-- WHY both totals in one function: they are read together on every render of
-- the progress surface, and two round trips to compute two sums over the same
-- table is the kind of thing this codebase should not be teaching itself to do.

create or replace function public.xp_totals(p_week_start date)
returns table (this_week int, lifetime int)
language sql
security invoker
stable
set search_path = ''
as $fn$
  select
    coalesce(sum(amount) filter (where week_start = p_week_start), 0)::int,
    coalesce(sum(amount), 0)::int
  from public.xp_events;
$fn$;

-- INVARIANT: RLS and grants are two independent gates — ADR 0003.
revoke all on function public.xp_totals(date) from public, anon;
grant execute on function public.xp_totals(date) to authenticated;
