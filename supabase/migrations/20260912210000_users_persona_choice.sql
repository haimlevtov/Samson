-- Samson 0069 — the coach you chose, kept
--
-- Rework PR 8. One column, and the reason it is not a foreign key.
--
-- ADR 0031 §5 settles for "the first shared, voiced coach alphabetically" when
-- a session needs a voice, and says in as many words that persisting the choice
-- "is a column and a settings control, and it belongs with whatever change
-- wants it on more than one screen". Onboarding now asks which coach you want,
-- which is that change: the Coach tab's picker dies with the page, so until now
-- the answer had nowhere to go.

alter table public.users
  add column persona_slug text;

-- WHY NOT `references public.personas (slug)`, which the plan entry for this PR
-- said it would be, wrongly:
--
--   1. There is no unique constraint on `personas.slug` to point at. The table's
--      uniqueness is `(user_id, slug) nulls not distinct` — a user may own a
--      persona whose slug matches a shared one. Adding a bare unique on `slug`
--      to make the FK possible would forbid that, which is a change to the
--      content table in service of a preference column.
--
--   2. It would not buy what it looks like it buys. A coach is retired by
--      setting `is_active = false`, not by deleting the row, and `listPersonas`
--      filters on it — so "the stored slug names a coach the picker no longer
--      offers" is reachable with the constraint fully satisfied. The fallback to
--      the first listed coach is therefore REQUIRED either way, and once it
--      exists an FK removes no case the app can feel.
--
-- So the integrity here is code's: the welcome step validates the posted slug
-- against the rows `listPersonas` returned, and every reader falls back.
comment on column public.users.persona_slug is
  'Rework PR 8 / ADR 0031 §5. The coach the user picked, or null for has not chosen. Not an FK — personas is unique on (user_id, slug), and is_active retires a coach without deleting it, so readers fall back regardless.';

-- ---------------------------------------------------------------------------
-- The reset has to clear it too
-- ---------------------------------------------------------------------------
--
-- `persona_slug` is an onboarding ANSWER, so a reset that leaves it behind
-- leaves the coach step answered and the flow walks straight past it. That is
-- the same fault review found in PR 4 — `plan_runs` survived the reset, so
-- onboarding decided the plan step had been answered and never offered it —
-- and it is worth naming as a class rather than a coincidence:
--
--   AI-NOTE: every column or table that `src/onboarding/steps.ts` reads to
--            decide whether a step is answered MUST be cleared here. A new
--            onboarding question means an addition to this function, or the
--            reset silently shortens the flow it exists to restore.
--
-- Restated in full rather than patched: an applied migration is never re-run,
-- so the previous definition stands in the deployed database until this one
-- replaces it whole.

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
  -- AI-NOTE: `raw_app_meta_data`, never the email — 20260912200000 carries why,
  --          and the address is a string the caller chooses.
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
      persona_slug = null,
      onboarded_at = null
  where user_id = uid;

  -- `llm_calls` is NOT touched, deliberately — ADR 0032's Consequences. The
  -- weekly budget is computed from it (ADR 0026), so clearing those rows would
  -- make this a way to refill the project's spend limit on demand.
end;
$$;

-- `create or replace` preserves the existing ACL, so this is belt and braces —
-- and 20260912190000 is why it is written out every time rather than assumed.
revoke all on function public.reset_demo_account() from public, anon;
grant execute on function public.reset_demo_account() to authenticated;
