-- Samson 0066 — a goal with somewhere to live, and a reset that actually resets
--
-- ADR 0032. Two columns and one function.

-- ---------------------------------------------------------------------------
-- 1. The diet goal — ADR 0032 §3
-- ---------------------------------------------------------------------------
--
-- The Coach tab has had a goal selector since the diet stage shipped, and its
-- value survives exactly one request. Onboarding cannot ask a question it has
-- nowhere to put the answer to.

alter table public.users
  add column diet_goal text;

-- The same three values `DIET_GOALS` holds in src/diet/energy.ts. Two copies of
-- one fact, the way `llm_calls.stage` is — and like that one, the copy here is
-- what a hand-written POST is held to.
alter table public.users
  add constraint users_diet_goal_check
  check (diet_goal is null or diet_goal in ('cut', 'maintain', 'gain'));

-- WHY nullable rather than `default 'maintain'`: "has not said" and "said
-- maintain" are different, and only the first should make a surface ask.
comment on column public.users.diet_goal is
  'ADR 0032 §3. Null means the user has not chosen; readers fall back to maintain.';

-- ---------------------------------------------------------------------------
-- 2. Whether this person has been through onboarding — ADR 0032 §2, amended
-- ---------------------------------------------------------------------------
--
-- FOUND IN REVIEW. The first version of ADR 0032 derived "is this a new user"
-- from the display name being absent, on the reasoning that no onboarding state
-- should be stored because the real tables already know.
--
-- That reasoning is right about the STEPS and wrong about the FLOW. A blank
-- display name is a supported steady state, not a signal: `settingsSchema`
-- transforms an empty name to null deliberately — "empty means no name, not an
-- empty name — the headers fall back to email" — so deriving from it bounces a
-- long-standing user who cleared their name back into onboarding, permanently.
--
-- Which step to show is still derived and still needs no column. Whether the
-- flow has ever been completed is not derivable from anything, so it is one
-- column and no more.
alter table public.users
  add column onboarded_at timestamptz;

comment on column public.users.onboarded_at is
  'ADR 0032 §2. Null means the welcome flow has never been finished. Which STEP to show is still derived from the data.';

-- ---------------------------------------------------------------------------
-- 3. The reset — ADR 0032 §4
-- ---------------------------------------------------------------------------
--
-- FOUND IN REVIEW, and it is the same mistake the application module correctly
-- diagnosed for `public.users` one comment lower: the policies were read for one
-- table and assumed for the rest.
--
-- `achievement_events`, `xp_events` and `challenges` are `for select` only
-- (20260824150248); `plan_runs` is select + insert (20260901115234). All four are
-- deliberate — ADR 0009's position is that no completion may be granted from the
-- client. `authenticated` holds the DELETE grant, so a client delete is not
-- rejected: RLS filters it to zero rows, PostgREST returns 204, and the app
-- reports success while the XP, the badges, the challenges and the accepted plan
-- all survive. The user is told, by name, that they were removed.
--
-- WHY NOT `..._delete_own` POLICIES. Because one of them is a real cheat:
-- `achievement_events` is once-only (20260902100300), and a user who can delete
-- their own rows can re-earn every badge and be paid its XP again. ADR 0009 §3's
-- whole position is that the client does not get to write gamification outcomes,
-- and "delete" is a write.
--
-- So: a `security definer` function, the same shape `accept_challenge` and
-- `award_session_xp` already use for "the client may not write this table, and
-- this specific operation is nonetheless allowed".
--
-- Two things make it safe, and neither is the application's email check:
--
--   * IT TAKES NO ARGUMENT. The user is `auth.uid()`, from the verified JWT, so
--     there is nothing to point somewhere else. A caller cannot express the
--     wish to delete somebody else's rows.
--   * IT CHECKS THE ACCOUNT ITSELF. The email gate moves from a convenience in
--     the app to a control in the database — which also closes the re-earn cheat
--     above for every other user, because no other user can call this at all.
--
-- And it is ONE TRANSACTION, which the loop it replaces was not: a failure
-- partway through that loop left an account half reset, with the card saying to
-- try again.
create or replace function public.reset_demo_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  addr text;
begin
  if uid is null then
    raise exception 'reset_demo_account requires a signed-in caller'
      using errcode = 'insufficient_privilege';
  end if;

  select email into addr from auth.users where id = uid;

  -- AI-NOTE: this address is also `DEMO_ACCOUNT_EMAIL` in src/db/demo-reset.ts.
  --          Two copies of one fact; tests/db/demo-reset.test.ts holds them
  --          together by calling the function as a user who is not it.
  if addr is distinct from 'fresh@samson.test' then
    raise exception 'reset_demo_account is only for the demo account'
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
  -- policy either, and every reader defaults for a missing field, so a row of
  -- nulls and no row are the same thing to the app. Settings — timezone, theme,
  -- humour ceiling, leaderboard opt-out — are preferences about using the app
  -- rather than training data, and are left alone.
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

revoke all on function public.reset_demo_account() from public;
grant execute on function public.reset_demo_account() to authenticated;
