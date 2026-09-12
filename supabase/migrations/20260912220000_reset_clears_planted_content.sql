-- Samson 0070 — the reset deletes everything the user wrote, including what the
-- app never writes
--
-- FOUND IN REVIEW, on the PR that moved the reset to the sign-in page.
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
--
-- `reset_demo_account()` cleared nine training tables. EIGHT MORE carry a
-- `user_id` and a permissive write policy the application never uses:
-- `exercises`, `equipment_tags`, `exercise_equipment`, `progression_nodes`,
-- `personas`, `achievements`, `tonnage_comparisons`, `supplement_evidence`.
--
-- `src/db/demo-reset.ts` used to carry an AI-NOTE naming that residue. **The
-- same PR deleted the note** — along with the arrays it sat on, which nothing
-- rendered any more — and left the gap undocumented anywhere. A known gap with
-- its only record removed is worse than either the gap or the note alone.
--
-- ---------------------------------------------------------------------------
-- Why it matters more now than it did
-- ---------------------------------------------------------------------------
--
-- The demo account is SHARED. Its password is printed on the sign-in page and
-- its reset is one unauthenticated button, so "a user's own rows" and "rows the
-- next person sees" are the same rows here. And this PR added a surface that
-- renders them: the welcome flow's coach step lists `listPersonas`, whose read
-- policy is `user_id is null OR user_id = auth.uid()`.
--
-- So the path was: press Reset, receive a demo session, INSERT a persona with an
-- attacker-authored name and sample line, press Reset again — and the row
-- survives to greet the next person through onboarding. A planted `exercises`
-- row is worse in kind: `exercises_read` admits it, so it reaches the planner's
-- candidate set (CLAUDE.md #5).
--
-- The rendered text is escaped by React and `system_prompt` is fenced into
-- `messages` rather than the instruction channel (CLAUDE.md #11), so this is
-- residue rather than an injection. The control built to clear it should clear
-- it.
--
-- ---------------------------------------------------------------------------
-- The order, which is not arbitrary
-- ---------------------------------------------------------------------------
--
-- `progression_nodes.exercise_id`, `sets.exercise_id` and
-- `workout_template_items.exercise_id` are all ON DELETE RESTRICT, so a
-- user-owned exercise cannot go until everything pointing at it has. `sets` and
-- the template items are already cleared above; the nodes are added before the
-- exercises here. `exercise_equipment` cascades from both parents, and is still
-- deleted explicitly — a user can link two SHARED rows, and that row belongs to
-- neither parent's owner.
--
-- A RESTRICT that fires raises, which aborts the whole function. That is the
-- right behaviour: a reset that half ran is worse than one that says it failed,
-- and the caller now renders a message rather than swallowing it.
--
-- AI-NOTE: "everything the app wrote" is exact. A new table with a `user_id`
--          and a write policy belongs in this list, and a new onboarding
--          question's column belongs in the UPDATE below — `src/onboarding/
--          steps.ts` reads those to decide whether a step is answered, and a
--          survivor silently shortens the flow this exists to restore.

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

  -- Training. Children before parents: `sets` references `workouts`, and
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

  -- Content the app never writes and a hand-written POST can. See the header.
  delete from public.progression_nodes where user_id = uid;
  delete from public.exercise_equipment where user_id = uid;
  delete from public.exercises where user_id = uid;
  delete from public.equipment_tags where user_id = uid;
  delete from public.personas where user_id = uid;
  delete from public.achievements where user_id = uid;
  delete from public.tonnage_comparisons where user_id = uid;
  delete from public.supplement_evidence where user_id = uid;

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
