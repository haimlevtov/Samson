-- Samson 0035 — the rest of the achievement set
--
-- Plan: docs/plans/phase-5-content-fill.md, PR 2.
-- Skill: .claude/skills/add-achievement/SKILL.md — the row, the predicate, the
--        humour tier and the tests, in one change.
--
-- INVARIANT: content lives in the database, not in code — CLAUDE.md #7. Nine
--            rows and no application branch.
--
-- `achievements.tier` has allowed eight tiers since the phase-0 schema and
-- exactly one was ever used. Every tier now has at least one row.
--
-- ---------------------------------------------------------------------------
-- Three rules every predicate below follows
-- ---------------------------------------------------------------------------
--
-- 1. NO PREDICATE COMPUTES AN e1RM. Epley lives in src/metrics/e1rm.ts. A
--    second definition in SQL means the badge and the progression chart can
--    disagree about the same set, and the one the user believes is whichever
--    they saw last. PR-tier work is written against raw logged weight instead.
--
-- 2. IMPLAUSIBLE SETS EARN NOTHING. src/gamification/plausibility.ts states the
--    rule and the reason: an implausible set stays in the log as the user's own
--    data and is excluded from REWARDS only. The bounds below are its
--    MAX_PLAUSIBLE_WEIGHT_KG and MAX_PLAUSIBLE_REPS, and
--    tests/db/achievements.test.ts reads them out of these predicates so the
--    two cannot drift apart silently.
--
--    This gate is DELIBERATELY WEAKER than the TypeScript one, which also
--    rejects a set past 1.5x the user's established best — that comparison
--    needs an e1RM and rule 1 forbids one here. So these bounds catch a typed
--    2000 and not a typed 140-for-100. What makes that acceptable is the size
--    of the prize: 75 XP, once, ever.
--
--    It also means the tonnage this predicate sums can be slightly LESS than
--    the all-time figure on Profile, which applies no plausibility filter
--    because it is reporting the log rather than paying for it. That divergence
--    is the rule above working, not a bug in either number.
--
-- 3. CALENDAR PREDICATES READ workouts.local_date AND NOTHING ELSE.
--    INVARIANT: calendar achievements use the user's local date — CLAUDE.md #9.
--    That column is resolved once at write time from users.timezone (migration
--    0003), so it is ALREADY local. now(), current_date and started_at::date
--    are all the server's clock, and all of them fire on the wrong day for
--    every user who is not standing on it.
--
-- AI-NOTE: every predicate below is executed by evaluate_achievements(), which
--          runs with `search_path = ''`. Schema-qualify everything. An
--          unqualified `workouts` raises, is swallowed by that function's
--          exception handler, and the achievement then silently never fires —
--          no error reaches anyone.

insert into public.achievements (user_id, slug, name, description, predicate, tier, humor_level, hidden, source_hint)
values
  -- -------------------------------------------------------------------------
  -- consistency
  -- -------------------------------------------------------------------------
  (
    null,
    'twenty-of-twenty-eight',
    'The Long Game',
    'Twenty kept days out of your last twenty-eight. Nobody was watching, which is rather the point.',
    -- Same shape as first-full-week and for the same reason: the window is
    -- anchored to the user's OWN most recent logged day rather than to
    -- current_date, which removes the clock from the predicate entirely. The
    -- same history always yields the same answer.
    $pred$
      (select count(distinct w.local_date) >= 20
       from public.workouts w
       where w.user_id = $1
         and w.status in ('completed', 'rest')
         and w.local_date > (
           select max(w2.local_date) - 28
           from public.workouts w2
           where w2.user_id = $1
         ))
    $pred$,
    'consistency',
    'clean',
    false,
    null
  ),

  -- -------------------------------------------------------------------------
  -- volume
  -- -------------------------------------------------------------------------
  (
    null,
    'hundred-tonnes',
    'A Hundred Tonnes',
    'A hundred thousand kilograms moved, one set at a time. Warm-ups did not count towards it.',

    -- WHY a volume badge does not breach CLAUDE.md #4:
    -- The invariant forbids XP that SCALES with volume, because scaling pays
    -- people to overtrain — every extra set is worth more, so the rational move
    -- is always one more set. This pays a flat 75, once, forever. Passing 100t
    -- earns exactly what passing 900t earns, so there is no marginal reward for
    -- the next set and nothing to farm. The tier has been in the CHECK since
    -- the phase-0 schema; this is the row it was for.
    --
    -- Rule 2 above supplies the bounds. Warm-ups are excluded exactly as
    -- src/metrics/tonnage.ts excludes them, and for the reason it gives: a
    -- 20 kg warm-up is not a data point about strength.
    $pred$
      (select coalesce(sum(s.weight_kg * s.reps), 0) >= 100000
       from public.sets s
       where s.user_id = $1
         and s.is_warmup = false
         and s.weight_kg is not null and s.reps is not null
         and s.weight_kg > 0 and s.weight_kg <= 500
         and s.reps > 0 and s.reps <= 100)
    $pred$,
    'volume',
    'clean',
    false,
    null
  ),

  -- -------------------------------------------------------------------------
  -- pr
  -- -------------------------------------------------------------------------
  (
    null,
    'twenty-percent-up',
    'The Long Way Up',
    'Twenty percent heavier on a lift than the day you first tried it. That is what a few months looks like from outside.',

    -- Rule 1: raw logged weight, never an estimated 1RM. The comparison is the
    -- user against their own first working set on that exercise, which is the
    -- reference plausibility.ts uses and for the reason it gives — an absolute
    -- strength table either insults a strong lifter or waves through a
    -- beginner's typo, and cannot be tuned to do neither.
    --
    -- WHY the six-set floor: two sets is not a trend. One cautious first
    -- attempt followed by one confident second is 20% on nothing.
    $pred$
      (select exists (
        select 1
        from (
          select s.exercise_id,
                 max(s.weight_kg) as best,
                 (array_agg(s.weight_kg order by s.created_at))[1] as first_weight
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
    $pred$,
    'pr',
    'cheeky',
    false,
    null
  ),

  -- -------------------------------------------------------------------------
  -- comeback
  -- -------------------------------------------------------------------------
  (
    null,
    'three-weeks-away',
    'Nobody Kept Your Seat',
    'Three weeks gone, and you came back anyway. Starting again is the hardest set in the programme.',
    -- The gap is measured between consecutive COMPLETED days, so a run of
    -- planned-then-skipped rows in between does not paper over the absence.
    $pred$
      (select exists (
        select 1
        from (
          select w.local_date,
                 lag(w.local_date) over (order by w.local_date) as previous
          from public.workouts w
          where w.user_id = $1 and w.status = 'completed'
        ) g
        where g.previous is not null and g.local_date - g.previous >= 21
      ))
    $pred$,
    'comeback',
    'cheeky',
    false,
    null
  ),

  -- -------------------------------------------------------------------------
  -- recovery
  -- -------------------------------------------------------------------------
  (
    null,
    'ten-rest-days',
    'Doing Nothing, On Purpose',
    'Ten rest days taken as planned. Recovery is the part of training you do lying down.',
    -- INVARIANT: XP derives from adherence, never volume — CLAUDE.md #4. A rest
    -- day is a KEPT day, which is why 'rest' is a first-class workout status
    -- (migration 0003) rather than an absence of one. This badge is that rule
    -- made visible: the app pays for resting on plan, and there is no badge
    -- anywhere for training every day.
    $pred$
      (select count(*) >= 10
       from public.workouts w
       where w.user_id = $1 and w.status = 'rest')
    $pred$,
    'recovery',
    'clean',
    false,
    null
  ),

  -- -------------------------------------------------------------------------
  -- variety
  -- -------------------------------------------------------------------------
  (
    null,
    'five-patterns',
    'No Skipped Letters',
    'Five different movement patterns logged. There is no leg day joke here, because you did not skip it.',
    -- movement_pattern is a CHECKed column on public.exercises with seven
    -- values, so five is a real spread rather than a rounding of "most of them".
    $pred$
      (select count(distinct e.movement_pattern) >= 5
       from public.sets s
       join public.exercises e on e.id = s.exercise_id
       where s.user_id = $1
         and s.is_warmup = false
         and e.movement_pattern is not null)
    $pred$,
    'variety',
    'cheeky',
    false,
    null
  ),

  -- -------------------------------------------------------------------------
  -- hidden
  -- -------------------------------------------------------------------------
  --
  -- INVARIANT: hidden achievement definitions are never sent to the client —
  --            PLAN.md phase 5. Enforced by the achievements_read_visible
  --            policy from the phase-0 schema, not by any query.
  --
  -- AI-NOTE: a HELD hidden badge is a different question, answered by the
  --          companion migration 20260908090100. Its definitions reach the one
  --          user who has already unlocked it and nobody else.
  (
    null,
    'groundhog-set',
    'Groundhog Set',
    'Twenty sets of one lift at the same weight for the same reps. Consistency, technically.',
    $pred$
      (select exists (
        select 1
        from public.sets s
        where s.user_id = $1
          and s.is_warmup = false
          and s.weight_kg is not null and s.reps is not null
          and s.weight_kg > 0 and s.reps > 0
        group by s.exercise_id, s.weight_kg, s.reps
        having count(*) >= 20
      ))
    $pred$,
    'hidden',
    'cheeky',
    true,
    'Six more weeks and it is a tradition.'
  ),
  (
    null,
    'before-the-birds',
    'Before the Birds',
    'A session started before five in the morning — yours, not a server''s.',
    -- INVARIANT: timestamps are UTC plus the user's IANA timezone — CLAUDE.md #9.
    -- started_at is a timestamptz, so its hour means nothing until it has been
    -- converted through users.timezone. Reading it raw would award this to a
    -- user in Auckland training at a perfectly civilised hour, and withhold it
    -- from one in Los Angeles who genuinely got up at four.
    $pred$
      (select exists (
        select 1
        from public.workouts w
        join public.users u on u.user_id = w.user_id
        where w.user_id = $1
          and w.status = 'completed'
          and w.started_at is not null
          and extract(hour from (w.started_at at time zone u.timezone)) < 5
      ))
    $pred$,
    'hidden',
    'cheeky',
    true,
    null
  ),

  -- -------------------------------------------------------------------------
  -- calendar — the user's local date, never the server's
  -- -------------------------------------------------------------------------
  (
    null,
    'new-years-day',
    'Resolution, Kept',
    'You trained on the first of January. Most of the gym was there too; you came back on the second.',
    -- Rule 3. local_date is already the user's local date, resolved at write
    -- time. tests/db/achievements.test.ts puts one fixture at UTC+14 and one at
    -- UTC-11 either side of the date line: the pair is the test, because either
    -- one alone also passes under a server-date predicate. Together they
    -- invert, and only a local-date predicate satisfies both.
    $pred$
      (select exists (
        select 1
        from public.workouts w
        where w.user_id = $1
          and w.status in ('completed', 'rest')
          and extract(month from w.local_date) = 1
          and extract(day from w.local_date) = 1
      ))
    $pred$,
    'calendar',
    'cheeky',
    false,
    null
  ),
  (
    null,
    'one-year-on',
    'One Year On',
    'You trained on the anniversary of your first logged day. Same date, different lifter.',
    -- WHY an anniversary rather than a second fixed holiday: it is calendar-tier
    -- without assuming which calendar the user keeps, and it is still evaluated
    -- entirely in local dates. A user who started on 29 February waits four
    -- years for it, which is funny rather than broken.
    $pred$
      (select exists (
        select 1
        from public.workouts w
        where w.user_id = $1
          and w.status in ('completed', 'rest')
          and w.local_date > (
            select min(w2.local_date) from public.workouts w2 where w2.user_id = $1
          )
          and to_char(w.local_date, 'MM-DD') = (
            select to_char(min(w2.local_date), 'MM-DD')
            from public.workouts w2
            where w2.user_id = $1
          )
      ))
    $pred$,
    'calendar',
    'clean',
    false,
    null
  );
