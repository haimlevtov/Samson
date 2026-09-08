-- Samson 0049 — twenty-percent-up asks WHEN, and `created_at` cannot answer
--
-- Contract: docs/adr/0021-training-order-is-local-date.md, committed first.
--
-- FOUND 2026-09-08, seeding progression history. Adding bodyweight accessories
-- to two programmes made `returning` lose a badge it had held on the previous
-- run. Nothing about the weighted sets changed — their digest is byte-identical
-- across the two runs — so the input to a predicate that ignores unloaded sets
-- was unchanged, and the outcome still moved.
--
-- WHAT WAS WRONG
--
-- Migration 20260908090400 corrected this predicate's ordering to
-- `order by s.created_at, s.workout_id, s.set_index`, reasoning that
-- (workout_id, set_index) is unique per exercise and therefore breaks every
-- tie. That is true, and it is not the property the predicate needs.
--
-- A total order is not the same as the RIGHT order:
--
--   * `sets.created_at` defaults to now(), which is TRANSACTION time.
--     scripts/seed.ts writes a user's whole history in chunks, so it does not
--     merely tie sometimes — MEASURED on the hosted project for `returning`:
--     all 179 qualifying working sets carry ONE distinct created_at value.
--     The first sort key contributed nothing at all.
--
--   * That left `workout_id` deciding, and workout_id is a random uuid. "The
--     first working set" was the set from whichever session drew the
--     alphabetically lowest one — per exercise, one of the 8 to 10 sessions
--     holding a qualifying working set for it.
--
-- So the badge was awarded on a coin toss, and reseeding re-tossed it. MEASURED
-- for `returning`, best-over-first per exercise, uuid pick against true first:
--
--   barbell-full-squat      1.15 vs 1.25      standing-military-press 1.07 vs 1.25
--   bent-over-barbell-row   1.12 vs 1.19      incline-dumbbell-press  1.10 vs 1.38
--   barbell-deadlift        1.09 vs 1.19      romanian-deadlift       1.13 vs 1.24
--   barbell-bench-press-medium-grip 1.16 vs 1.22
--
-- Every ratio is understated, because a session drawn at random from a
-- progressing history is on average far heavier than the one the user actually
-- started on. They had earned the badge four times over and were told they had
-- not.
--
-- THE FIX
--
-- Order by when the training HAPPENED, not by when the row was written:
-- `workouts.local_date`, then `completed_at`, then `set_index`. local_date is
-- not null and is the project's canonical date — CLAUDE.md #9 — and a user can
-- log several sessions on one date, which is what completed_at settles.
-- `workout_id` stays on the end purely so the order is still total; it now
-- decides nothing that the three keys before it have not already decided.
--
-- The join cannot change which rows are considered: sets.workout_id is not null
-- and references workouts (id), so it matches exactly one row.
--
-- AI-NOTE: `created_at` on `sets` answers "when was this row written", never
--          "when was this lifted". Any future predicate, metric or chart that
--          wants training order must use workouts.local_date. Only `sets` is
--          bulk-written, which is why the other tables' created_at orderings
--          in src/db/ are fine as they are.

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
          join public.workouts w on w.id = s.workout_id
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
