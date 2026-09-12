-- Samson 0073 — how many hidden badges are left to find
--
-- ADR 0017's 2026-09-12 amendment, and rework PR 7.
--
-- The badge catalogue shows every achievement a user may see. A hidden one they
-- have NOT earned shows only that it exists — the owner chose a count over
-- silently omitting those rows, because a catalogue that drops rows teaches
-- people the list is complete when it is not.
--
-- WHY A FUNCTION, when the plan for this PR said none would be needed:
-- `achievements_read_visible` withholds a locked hidden row entirely. That is
-- its whole job and it is not being relaxed. But it means a client counting what
-- it can see counts zero, and cannot tell "no hidden badges exist" from "none are
-- visible to you". The count is simply not reachable through the policy.
--
-- WHY IT LEAKS NO DEFINITION: it returns ONE INTEGER. No name, no slug, no id, no
-- description, no tier, no predicate. A single number cannot be walked, paged or
-- probed. What it does disclose — that hidden badges exist, and how many — is the
-- owner's call, recorded in the ADR.
--
-- INVARIANT: no parameter. The caller counts for themselves; there is no
--            p_user_id to poison and no PostgREST filter that reaches the WHERE.
--
-- AI-NOTE: do NOT widen this to return rows, slugs or tiers "for the UI". The
--          moment it returns anything but a count it is the policy relaxation
--          ADR 0017 rejected twice, dressed as a function.

create or replace function public.hidden_achievements_remaining()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  remaining integer;
begin
  /*
   * FAILS CLOSED, and it has to be written. Without this, a null auth.uid()
   * joins no unlock events, so the NOT EXISTS below is true for every row and a
   * signed-out caller would receive the count of EVERY hidden badge. The revoke
   * below keeps anon away as well; this is what makes the function correct on
   * its own rather than only behind a grant.
   */
  if uid is null then
    return 0;
  end if;

  select count(*)::integer
    into remaining
    from public.achievements a
   where a.user_id is null
     and a.hidden
     and not exists (
       select 1
         from public.achievement_events e
        where e.achievement_id = a.id
          and e.user_id = uid
     );

  return remaining;
end;
$$;

-- `from public, anon` — 20260912190000's lesson. `revoke … from public` alone
-- leaves Supabase's explicit anon grant in place, and
-- tests/db/schema-invariants.test.ts fails on any definer function anon can run.
revoke all on function public.hidden_achievements_remaining() from public, anon;
grant execute on function public.hidden_achievements_remaining() to authenticated;

comment on function public.hidden_achievements_remaining() is
  'ADR 0017 (2026-09-12 amendment). How many shared hidden achievements the caller has not earned, as ONE integer and nothing else. Returns 0 with no caller. Never widen it to return rows.';
