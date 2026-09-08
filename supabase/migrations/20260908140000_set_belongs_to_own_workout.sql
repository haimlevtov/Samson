-- Samson 0050 — a set may only point at a workout the user owns
--
-- FOUND IN REVIEW of migration 20260908130000, 2026-09-08. That migration added
-- `join public.workouts w on w.id = s.workout_id` to `twenty-percent-up` and
-- claimed, correctly, that the join cannot widen the row set. What it did not
-- say is WHOSE row it matches, and that turned out not to be constrained.
--
-- REPRODUCED before writing this, as user alice against user bob on the hosted
-- project: alice inserted a set with `user_id = alice` and
-- `workout_id = <a workout owned by bob>`, and it was ACCEPTED.
--
-- WHY it was accepted: `sets_own` (migration 20260824150220) is
-- `using (user_id = auth.uid()) with check (user_id = auth.uid())`.
-- `sets.user_id` and `workouts.user_id` are independent columns and nothing
-- related them. The foreign key on `workout_id` runs as the referenced table's
-- owner and is not subject to RLS, so it happily resolves another user's row.
--
-- WHY it matters, beyond untidiness. `evaluate_achievements` is
-- `security definer` and these tables do not FORCE row level security, so a
-- predicate reads `public.workouts` with RLS off. ADR 0009 §3 states as its
-- third enforcement mechanism that "the predicate is executed against a
-- single-row subquery scoped to the evaluating user, so even a system predicate
-- cannot read across users" — repeated verbatim as a comment above the
-- `execute` in 20260908090200. Two predicates falsified it: both of the ones
-- that reach workouts THROUGH sets, filtering only `s.user_id = $1`.
--
-- Reachable as a date oracle rather than a data leak: insert your own
-- qualifying sets against a victim's workout id, then read back whether the
-- badge fired, and the answer is a function of the victim's `local_date`. Not
-- exploitable today, because no surface hands one user another's workout id.
-- That is a fact about today's surfaces, not about the boundary.
--
-- THE FIX, in two layers, because the predicates are the symptom.
--
-- 1. The policy. `with check` now requires the workout to be the user's, which
--    makes "a set belongs to a workout of the same user" true by RLS for every
--    write path that exists or will exist. Chosen over the schema alternative —
--    `unique (id, user_id)` on workouts plus a composite foreign key — because
--    that is DDL, and DDL means regenerating src/db/types.ts from a local stack
--    with the pinned CLI. The policy closes the same hole at the layer
--    CLAUDE.md #10 actually puts the guarantee at, with no generated-file risk.
--    The subquery is a primary-key lookup per inserted row.
--
--    `using` deliberately does NOT gain the clause. It is the read/visibility
--    half, and adding it would hide any row already written across the boundary
--    rather than making it visible to the owner who has to clean it up.
--
-- 2. Both predicates. Defence in depth: the join is scoped to the same user, so
--    a predicate stays user-scoped even if the policy is ever loosened. Every
--    other predicate that touches workouts already carries `w.user_id = $1` —
--    20260908090000 lines 83, 191, 218, 311, 340, 364 and 20260902090100 line
--    33. These two were the exceptions.
--
--    BOTH terms are written, and the second is not redundant. `w.user_id =
--    s.user_id` is the correctness one and holds however the parameter is
--    bound; `w.user_id = $1` is what the planner can actually use. MEASURED
--    without it: the plan is a `Seq Scan on workouts` — the whole table, every
--    user's rows — hashed on every evaluation, because nothing constrained `w`
--    and a `security definer` function is not narrowed by RLS either. With it,
--    `workouts_user_date_idx` (20260824150220) serves the lookup. No new index
--    is needed, and none can remove the per-group sort: the ordering lives
--    inside `array_agg(... order by ...)` across the join.
--
-- Existing rows are not audited or deleted here. Nothing is known to have
-- written one, and a DELETE against a table this policy now protects belongs in
-- its own migration with its own evidence.
--
-- AI-NOTE: a predicate that reaches public.workouts must filter it by the
--          evaluating user, whether it starts there or joins to it through
--          sets. `s.user_id = $1` alone is not enough — that is the bug this
--          migration exists for.

alter policy sets_own on public.sets
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.workouts w
      where w.id = workout_id
        and w.user_id = auth.uid()
    )
  );

-- twenty-percent-up — the ordering from 20260908130000 (ADR 0021), now scoped.
update public.achievements
set predicate = $fix$
      (select exists (
        select 1
        from (
          select s.exercise_id,
                 max(s.weight_kg) as best,
                 (array_agg(
                    s.weight_kg
                    order by w.local_date, s.completed_at, s.set_index, s.workout_id
                  ))[1] as first_weight
          from public.sets s
          join public.workouts w
            on w.id = s.workout_id and w.user_id = s.user_id and w.user_id = $1
          where s.user_id = $1
            and s.is_warmup = false
            and s.weight_kg is not null and s.reps is not null
            and s.weight_kg > 0 and s.weight_kg <= 500
            and s.reps > 0 and s.reps <= 100
          group by s.exercise_id
          having count(*) >= 6
        ) g
        where g.first_weight > 0 and g.best >= g.first_weight * 1.2
      ))
$fix$
where slug = 'twenty-percent-up' and user_id is null;

-- hundred-tonnes — same class, same fix. Its `count(distinct w.local_date)`
-- read dates straight off the joined row, so it was the more directly affected
-- of the two: sets attached to another user's workouts would have counted that
-- user's training days toward this user's thirty.
update public.achievements
set predicate = $fix$
      (select
         coalesce(sum(s.weight_kg * s.reps), 0) >= 100000
         and count(distinct w.local_date) >= 30
       from public.sets s
       join public.workouts w
         on w.id = s.workout_id and w.user_id = s.user_id and w.user_id = $1
       where s.user_id = $1
         and s.is_warmup = false
         and s.weight_kg is not null and s.reps is not null
         and s.weight_kg > 0 and s.weight_kg <= 500
         and s.reps > 0 and s.reps <= 100)
$fix$
where slug = 'hundred-tonnes' and user_id is null;
