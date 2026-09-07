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
   *
   * INVARIANT: the user's local date, never a server date — CLAUDE.md #9.
   *            `window_end` was written by the batch from
   *            `localToday(user.timezone)`, so comparing it to `current_date`
   *            compares a user-local date to a server one. West of UTC that
   *            hides the last hours of a window behind a button that renders
   *            and then refuses; east of UTC it grants a day past the close.
   *            Two other migrations refuse server dates for this exact reason —
   *            20260902090100 and 20260902100100.
   *
   * AI-NOTE: `at time zone 'utc'` looked like it handled this and did not.
   *          `current_date` is already "today in the session TimeZone", so
   *          wrapping it only coerces a date into a timestamp and is a no-op
   *          while that session happens to be UTC.
   */
  update public.challenges c
     set status = 'active'
   where c.id = p_challenge_id
     and c.user_id = auth.uid()
     and c.status = 'offered'
     and (
       c.window_end is null
       or c.window_end >= (
         now() at time zone coalesce(
           (select u.timezone from public.users u where u.user_id = auth.uid()),
           'UTC'
         )
       )::date
     );

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
