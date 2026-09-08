-- Samson 0039 — three corrections to predicates written earlier in this branch
--
-- ALL FOUND IN REVIEW, 2026-09-08, before any of them shipped to a user.
--
-- WHY an UPDATE rather than editing 20260908090000: that migration is already
-- applied. Editing an applied file makes the recorded history describe SQL that
-- was never run, which is the desync this project has repaired by hand twice.
-- Its COMMENTS were amended in place, because a comment is not stored in the
-- database and cannot desync anything; every statement change is here.
--
-- AI-NOTE: `predicate` is SQL text, so an UPDATE is how a predicate is ever
--          corrected. The slug is the identity a user holds and is never
--          reused — .claude/skills/add-achievement/SKILL.md — so fixing the
--          condition in place is right and issuing a new slug would be wrong.
--          A user who already holds the badge keeps it; achievement_events has
--          no memory of which version of the predicate let them in.

-- ---------------------------------------------------------------------------
-- 1. twenty-percent-up — "the first set" needs a defined answer
-- ---------------------------------------------------------------------------
--
-- It picked the first working set with
-- `(array_agg(s.weight_kg order by s.created_at))[1]`.
--
-- `sets.created_at` defaults to now(), which in Postgres is TRANSACTION time,
-- so every row written by one INSERT carries an identical timestamp — and
-- `order by` a column with ties leaves the order among them unspecified. `[1]`
-- was an arbitrary member of the first batch. The sort was being paid for
-- without buying an answer.
--
-- It is not hypothetical: scripts/seed.ts writes a session's sets in batches,
-- and startFromTemplate writes several rows at once. Two evaluations over
-- identical data could disagree, and SKILL.md §2 puts "deterministic — same
-- data, same result, always" first.
--
-- THE FIX: a total order. The exercise is already fixed by the GROUP BY, and
-- (workout_id, set_index) is unique per exercise — `sets_index_unique`,
-- migration 0003 — so those two columns cannot tie.

update public.achievements
set predicate = $fix$
      (select exists (
        select 1
        from (
          select s.exercise_id,
                 max(s.weight_kg) as best,
                 (array_agg(
                    s.weight_kg order by s.created_at, s.workout_id, s.set_index
                  ))[1] as first_weight
          from public.sets s
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

-- ---------------------------------------------------------------------------
-- 2. hundred-tonnes — close the spam route the PRD forbids by name
-- ---------------------------------------------------------------------------
--
-- docs/PRD.md §5.5 and .claude/skills/add-achievement/SKILL.md §2 both promise
-- the same thing about this exact badge: "an empty bar spammed for reps must
-- not unlock a volume badge."
--
-- The shipped predicate did not honour it. Fifty sets of 20 kg for 100 reps is
-- 100,000 kg, every set inside MAX_PLAUSIBLE_WEIGHT_KG and MAX_PLAUSIBLE_REPS,
-- and `checkPlausibility` would pass all of it too — 20 kg is not 1.5x anything.
-- One long typing session bought the badge.
--
-- WHY THE GATE IS TIME AND NOT LOAD: a load floor is an absolute strength
-- claim, and src/gamification/plausibility.ts rejects those on principle — it
-- says so at the top: an absolute ceiling "either insults a strong lifter or
-- waves through a beginner's typo, and it cannot be tuned to do both." The same
-- objection applies to a floor. What CAN be asserted without any claim about
-- how strong anybody is: a hundred tonnes is not moved in a weekend.
--
-- Thirty distinct logged days. Someone determined to fake it must now log on
-- thirty separate days, which is adherence — the only thing this app pays for
-- anyway (CLAUDE.md #4). The badge becomes volume-over-time rather than volume,
-- which is closer to what it was always trying to celebrate.
--
-- WHY 30 and not 90: it has to be reachable by an honest user in a training
-- block rather than a year. Thirty logged days at a few tonnes each is an
-- ordinary two months of lifting.

update public.achievements
set predicate = $fix$
      (select
         coalesce(sum(s.weight_kg * s.reps), 0) >= 100000
         and count(distinct w.local_date) >= 30
       from public.sets s
       join public.workouts w on w.id = s.workout_id
       where s.user_id = $1
         and s.is_warmup = false
         and s.weight_kg is not null and s.reps is not null
         and s.weight_kg > 0 and s.weight_kg <= 500
         and s.reps > 0 and s.reps <= 100)
$fix$
where slug = 'hundred-tonnes' and user_id is null;

-- ---------------------------------------------------------------------------
-- 3. groundhog-set and five-patterns — the nonsense bounds they were missing
-- ---------------------------------------------------------------------------
--
-- Neither can be inflated by a bad weight — one counts sets and the other
-- counts patterns — so this changes no outcome that matters. It is here because
-- the migration header stated rule 2 as covering every predicate and two of
-- them did not carry it, and a comment that is false about its own file is
-- worse than a missing bound.
--
-- NOTE the asymmetry, which is deliberate: five-patterns keeps counting sets
-- with a NULL or zero weight. A bodyweight pull-up has no external load, and a
-- weight floor would lock a calisthenics user out of the badge for good —
-- src/metrics/tonnage.ts makes the same call for the same reason.

update public.achievements
set predicate = $fix$
      (select exists (
        select 1
        from public.sets s
        where s.user_id = $1
          and s.is_warmup = false
          and s.weight_kg is not null and s.reps is not null
          and s.weight_kg > 0 and s.weight_kg <= 500
          and s.reps > 0 and s.reps <= 100
        group by s.exercise_id, s.weight_kg, s.reps
        having count(*) >= 20
      ))
$fix$
where slug = 'groundhog-set' and user_id is null;

update public.achievements
set predicate = $fix$
      (select count(distinct e.movement_pattern) >= 5
       from public.sets s
       join public.exercises e on e.id = s.exercise_id
       where s.user_id = $1
         and s.is_warmup = false
         and e.movement_pattern is not null
         and (s.weight_kg is null or s.weight_kg <= 500)
         and (s.reps is null or s.reps <= 100))
$fix$
where slug = 'five-patterns' and user_id is null;
