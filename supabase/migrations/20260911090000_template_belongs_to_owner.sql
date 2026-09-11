-- Samson 0054 — a session and a template item may only point at the user's own template
--
-- FOUND IN REVIEW of PR #42, 2026-09-11. The same class as 20260908140000, one
-- table along, and that migration's reasoning applies here nearly verbatim —
-- read it first.
--
-- REPRODUCED before writing this, as throwaway users alice and bob on the
-- hosted project, by the two "one of bob templates" cases in
-- tests/db/rls.test.ts: alice inserted a `workouts` row with
-- `template_id = <bob's template>`, and a `workout_template_items` row into bob's
-- template, and BOTH were ACCEPTED — "expected null not to be null" on each.
-- The positive control, alice using her own template, passed in the same run.
--
-- WHY they were accepted: `workouts_own` (20260824150220) and
-- `workout_template_items_own` (20260905090000) are both
-- `with check (user_id = auth.uid())`. `template_id` is a separate column, and a
-- foreign key is checked as the referenced table's owner rather than under RLS,
-- so it resolves another user's template without complaint. ADR 0003's
-- 2026-09-11 amendment turns that into a rule.
--
-- What it allowed, measured against today's code rather than imagined:
--   * an existence oracle — success versus a foreign-key error says whether a
--     template id exists;
--   * on the items side, the unique (template_id, position) constraint tells the
--     writer which positions the owner has used;
--   * nothing READ across users: app/history/[id]/page.tsx loads the template
--     under the viewer's own RLS and gets nothing back.
-- The real danger was the two comments that claimed RLS already refused this —
-- app/workout/actions.ts and tests/db/seeded-templates.test.ts — sitting where
-- the next `security definer` function would read them. That is how the sets
-- bug happened.
--
-- AUDITED on hosted, read-only. This migration had not been applied there when
-- it was written, nor when review revised it — it reaches hosted by
-- `supabase db push` after the PR merges; on 2026-09-11 hosted's `workouts_own`
-- still read `(user_id = auth.uid())`. The audit found no session and no
-- template item pointing at another user's template, so the tighter check
-- strands nothing. Checked rather than assumed: a row that had crossed would
-- still be visible and deletable, but no longer finishable, since finishing
-- re-runs `with check`.
--
-- THE FIX: the write half only, as in 20260908140000.
--   * `with check` now requires the template to be the writer's own. A null
--     `template_id` — every session started without one — still passes.
--   * `using` is untouched. It is the read/visibility half, and adding the
--     clause there would hide a row already written across the boundary instead
--     of leaving it visible to the owner who has to clean it up.
--   * Every column reference inside a subquery is qualified with its table —
--     `workouts.template_id`, not `template_id` — so a column added to
--     `workout_templates` later cannot capture the name. The top-level
--     `user_id` and `template_id is null` sit outside any subquery, where
--     nothing can capture them. FOUND IN REVIEW; 20260911100000 does the same.
--   * Policy only: no DDL, so src/db/types.ts does not change and no local stack
--     is needed to regenerate it.
--
-- An UPDATE is checked too, since both policies are `for all`: finishing a
-- session rewrites the row and re-runs `with check` against the new one, whose
-- `template_id` is still the user's own — or null, once the template was deleted
-- and `on delete set null` cleared it. That cascade runs as the table owner and
-- is not subject to the policy.
--
-- AI-NOTE: tests/db/schema-invariants.test.ts reads every foreign key into a
--          user-ownable table from the catalogue and fails on an unchecked one.
--          It pins the three columns still unchecked. What each one needs is
--          in 20260911100000's AI-NOTE and ADR 0003's 2026-09-11 amendment.

alter policy workouts_own on public.workouts
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      template_id is null
      or exists (
        select 1
        from public.workout_templates t
        where t.id = workouts.template_id
          and t.user_id = auth.uid()
      )
    )
  );

alter policy workout_template_items_own on public.workout_template_items
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.workout_templates t
      where t.id = workout_template_items.template_id
        and t.user_id = auth.uid()
    )
  );
