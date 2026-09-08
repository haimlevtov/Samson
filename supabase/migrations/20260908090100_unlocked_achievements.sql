-- Samson 0036 — what a held hidden badge looks like
--
-- Plan: docs/plans/phase-5-content-fill.md, PR 2.
--
-- The phase-0 schema wrote the policy and left the consequence open:
--
--   create policy achievements_read_visible on public.achievements
--     for select to authenticated
--     using ((user_id is null or user_id = auth.uid()) and hidden = false);
--
-- INVARIANT: hidden achievement definitions are never sent to the client —
--            PLAN.md phase 5. That policy is the enforcement and it stays
--            exactly as it is; nothing below weakens it.
--
-- The consequence nobody had decided: a hidden badge a user has ALREADY
-- UNLOCKED joins to nothing through that policy. src/db/gamification.ts said so
-- in an AI-NOTE — "phase 5 owns deciding what a held hidden badge should look
-- like. Until then it is filtered out rather than rendered as a blank card" —
-- so today, unlocking one shows the user nothing whatsoever. The event row
-- exists, the XP is paid, and the reward is invisible.
--
-- THE DECISION: a held hidden badge is revealed to its holder and to nobody
-- else. Unlocking one silently is the worst of the available answers — the
-- definition stays secret AND the reward disappears, so the user is paid in a
-- currency they cannot see.
--
-- WHY this leaks nothing: the function returns rows the caller already has an
-- achievement_events row for. Knowing what you hold is not knowing what exists.
-- There is no way to enumerate the locked ones, no way to ask "would this
-- fire", and no way to see another user's — the WHERE clause is auth.uid() and
-- takes no parameter, so the caller does not get to say who they are.
--
-- WHY a SECURITY DEFINER function rather than relaxing the policy: a policy of
-- "hidden = false OR I hold it" would put the exception inside the control, and
-- every future query against `achievements` would inherit it. Keeping the
-- policy absolute and adding one narrow, parameterless read leaves exactly one
-- place to audit.

create or replace function public.unlocked_achievements()
returns table (
  slug text,
  name text,
  description text,
  tier text,
  hidden boolean,
  source_hint text,
  unlocked_at timestamptz,
  local_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.slug, a.name, a.description, a.tier, a.hidden, a.source_hint,
         e.unlocked_at, e.local_date
  from public.achievement_events e
  join public.achievements a on a.id = e.achievement_id
  -- Not a parameter. A p_user_id would let a browser ask about somebody else,
  -- and no amount of care in the caller would make that safe — ADR 0009.
  where e.user_id = auth.uid()
  order by e.unlocked_at desc;
$$;

-- INVARIANT: RLS and grants are two independent gates — ADR 0003. A signed-out
-- session gets nothing here even though the function's own WHERE clause would
-- already return nothing for it.
revoke all on function public.unlocked_achievements() from public, anon;
grant execute on function public.unlocked_achievements() to authenticated;
