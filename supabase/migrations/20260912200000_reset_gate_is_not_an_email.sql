-- Samson 0068 — the reset gate stops being a string the caller can claim
--
-- FOUND IN REVIEW, verified against the hosted project, and it was live.
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
--
-- 20260912180000 gated `reset_demo_account()` on `auth.users.email` matching
-- 'fresh@samson.test'. **An email address is a user-mutable attribute, not an
-- identity.** `enable_signup` is true and `enable_confirmations` is false, so
-- anybody with the publishable anon key — which ships in the client bundle by
-- design — can register an address and have `auth.users.email` set immediately,
-- with no deliverable-mail step in between.
--
-- And the address was FREE. `tests/db/demo-reset.test.ts` deleted whoever held
-- it and recreated it, and `tests/db/helpers.ts` records that a workstation
-- without Docker runs that suite against the hosted project. A count on hosted
-- returned zero while the review was being written.
--
-- What that bought an attacker is precisely the cheat 20260912180000's own
-- comment says it exists to prevent. The function is `security definer`, owned
-- by a role with `rolbypassrls`, so it deletes from `achievement_events`,
-- `xp_events`, `challenges` and `plan_runs` — the four tables whose policies are
-- `for select` only so that a client cannot write gamification outcomes (ADR
-- 0009). `achievement_events_once` is what makes a badge once-only; with those
-- rows gone, every badge is re-earnable and its XP re-payable, and XP feeds the
-- leaderboard.
--
-- The `..._delete_own` policy was correctly rejected. The function then
-- reintroduced the same capability behind a gate made of a string the attacker
-- chooses.
--
-- ---------------------------------------------------------------------------
-- What replaces it
-- ---------------------------------------------------------------------------
--
-- `raw_app_meta_data`, which is writable ONLY by the service role: the client
-- SDK's `updateUser` writes `raw_user_meta_data`, a different column, and there
-- is no path from an anon or authenticated session to this one. The seeder
-- stamps it when it creates the account (`scripts/seed.ts`).
--
-- So the gate is now a fact about the account that the account cannot set,
-- which is what "a control" has to mean. The email is no longer load-bearing
-- anywhere in this function.
--
-- AI-NOTE: do not "simplify" this back to an email, a display name, or anything
--          else a signed-in user can change about themselves. The whole point of
--          the column choice is that the caller cannot reach it.

create or replace function public.reset_demo_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  marked boolean;
begin
  if uid is null then
    raise exception 'reset_demo_account requires a signed-in caller'
      using errcode = 'insufficient_privilege';
  end if;

  -- Null-safe: a missing user, a missing key or a non-'true' value all refuse.
  select coalesce(raw_app_meta_data ->> 'demo_reset', '') = 'true'
    into marked
    from auth.users
   where id = uid;

  if marked is distinct from true then
    raise exception 'reset_demo_account is only for a marked demo account'
      using errcode = 'insufficient_privilege';
  end if;

  -- Children before parents. `sets` references `workouts`, and
  -- `workout_template_items` cascades from `workout_templates`.
  delete from public.sets where user_id = uid;
  delete from public.workouts where user_id = uid;
  delete from public.workout_templates where user_id = uid;
  delete from public.plan_runs where user_id = uid;
  delete from public.challenges where user_id = uid;
  delete from public.achievement_events where user_id = uid;
  delete from public.xp_events where user_id = uid;
  delete from public.coach_notes where user_id = uid;
  delete from public.user_equipment where user_id = uid;

  -- The profile is emptied rather than deleted: `public.users` has no delete
  -- policy, and every reader defaults for a missing field, so a row of nulls and
  -- no row are the same thing to the app. The SETTINGS — timezone, theme, humour
  -- ceiling, leaderboard opt-out — are preferences about using the app rather
  -- than training data, and are left alone.
  update public.users
  set display_name = null,
      bodyweight_kg = null,
      height_cm = null,
      birth_date = null,
      sex = null,
      diet_goal = null,
      onboarded_at = null
  where user_id = uid;

  -- `llm_calls` is NOT touched, deliberately — ADR 0032's Consequences. The
  -- weekly budget is computed from it (ADR 0026), so clearing those rows would
  -- make this a way to refill the project's spend limit on demand.
end;
$$;

-- `from public, anon` — 20260912190000's lesson, applied at the point of
-- creation this time. `create or replace` preserves the existing ACL, so this is
-- belt and braces rather than strictly required.
revoke all on function public.reset_demo_account() from public, anon;
grant execute on function public.reset_demo_account() to authenticated;
