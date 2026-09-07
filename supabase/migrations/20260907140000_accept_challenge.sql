-- Samson 0030 — accepting a challenge is what puts it in play
--
-- Contract: docs/specs/xp-and-challenges.md, "The lifecycle, and what accepting
-- is for". Trust boundary: docs/adr/0009-gamification-trust.md.
--
-- `challenges` has a read-only RLS policy and no write policy at all, so a
-- client cannot update its own row — which is deliberate, and is why this is a
-- function rather than a `.update()` in a server action.
--
-- INVARIANT: accepting carries no numbers. The caller names a challenge; it
--            does not say how far along it is, and it cannot say it is met.
--            Whether a challenge was COMPLETED is still derived from logged
--            rows by evaluateChallenge in the weekly batch, so phase 4's "no
--            completion can be granted from the client" is untouched.

create or replace function public.accept_challenge(p_challenge_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_accepted int;
begin
  /*
   * The status filter IS the idempotency guard, and the ownership filter is the
   * authorisation. Both live in the UPDATE rather than in a preceding SELECT:
   * checking first and writing after leaves a window where two presses both
   * pass the check. Whichever commits second matches no row.
   *
   * `window_end` is checked here too, so a challenge whose window has closed
   * cannot be put in play — nothing expires them, so they linger as `offered`
   * and would otherwise stay acceptable forever.
   */
  update public.challenges
     set status = 'active'
   where id = p_challenge_id
     and user_id = auth.uid()
     and status = 'offered'
     and (window_end is null or window_end >= (current_date at time zone 'utc'));

  get diagnostics v_accepted = row_count;
  return v_accepted > 0;
end;
$fn$;

-- INVARIANT: RLS and grants are two independent gates — ADR 0003.
-- AI-NOTE: revoking from `public` is NOT enough on Supabase; `authenticated`
--          holds its own default grant. That mistake has been made twice on
--          this project already — 20260901145239 and 20260902094000.
revoke all on function public.accept_challenge(uuid) from public, anon;
grant execute on function public.accept_challenge(uuid) to authenticated;
