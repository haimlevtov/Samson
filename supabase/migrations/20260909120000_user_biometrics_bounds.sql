-- Samson 0052 — bounds on the four biometric columns, before anything writes them
--
-- ADR 0024, docs/specs/diet.md §1. These columns have existed since
-- 20260824150139_users.sql and NOTHING has ever read or written them: every row
-- in the database holds four NULLs. The settings form starts writing them in
-- this same PR, so this is the last moment the constraints can be tightened
-- without a backfill.
--
-- ---------------------------------------------------------------------------
-- 1. `check (x > 0)` does not exclude NaN
-- ---------------------------------------------------------------------------
--
-- MEASURED against the hosted project and recorded in
-- 20260908100100_tonnage_comparisons_hardening.sql: `select ('NaN'::numeric > 0)`
-- returns TRUE, because PostgreSQL orders NaN above every non-NaN numeric so it
-- can be indexed and sorted. PostgREST will cast the JSON string "NaN" into the
-- column on the way in.
--
-- WHY it matters more here than it did there. A NaN mass was inert: the tonnage
-- comparison skipped it with Number.isFinite. A NaN bodyweight reaches
-- Mifflin-St Jeor, and NaN propagates through Math.min and Math.max, so the
-- clamp does not stop it. The result is `NaN`, which is NOT null, so the
-- missing-biometric refusal in src/diet/ does not fire either — the one branch
-- that exists to catch an unusable input is the one it slips past. A user would
-- be shown "NaN kcal" as a prescription.
--
-- `< 1000` is false for NaN, which is what closes it. The magnitude bound comes
-- free and is worth having on its own: numeric(6, 2) admits 9,999.99 kg and
-- numeric(5, 1) admits 9,999.9 cm. Both maxed is a BMR near 162,000 kcal;
-- the weight alone at an ordinary height is still around 101,000.
--
-- SCALE MATTERS HERE TOO, and it is easy to miss: Postgres rounds a numeric to
-- its declared scale BEFORE these CHECKs run. height_cm is numeric(5, 1), so a
-- submitted 299.99 becomes 300.0 and then violates `< 300` — an error on a
-- value the form accepted, which no retry can fix. src/diet/biometrics.ts
-- therefore admits one decimal place for height and two for weight, so the two
-- gates agree rather than merely both existing.
--
-- DELIBERATELY HUMAN BOUNDS, unlike 20260908100100's `< 1e10`. That migration
-- chose the type's own ceiling because the column held the mass of the Eiffel
-- Tower and any bound was arbitrary. This column holds a person: the heaviest
-- ever recorded was 635 kg and the tallest 272 cm, so 1000 and 300 are past any
-- real value while still rejecting a typo that a type-shaped bound would admit.
--
-- AI-NOTE: src/diet/energy.ts refuses non-finite input on its own and does not
--          rely on these. Two gates, because the constraint cannot see a value
--          that arrives through a path that skips the column, and the code
--          cannot see a row written before it existed.

alter table public.users
  drop constraint if exists users_bodyweight_kg_check;

alter table public.users
  add constraint users_bodyweight_kg_check
  check (bodyweight_kg > 0 and bodyweight_kg < 1000);

alter table public.users
  drop constraint if exists users_height_cm_check;

alter table public.users
  add constraint users_height_cm_check
  check (height_cm > 0 and height_cm < 300);

-- ---------------------------------------------------------------------------
-- 2. birth_date had no constraint at all
-- ---------------------------------------------------------------------------
--
-- It is the only one of the four that shipped unconstrained, and it is the one
-- ADR 0024 §6 gates a refusal on: under 18, no calorie target.
--
-- A future date produces a NEGATIVE age, which trips that refusal by accident.
-- Being right by accident is not the same as being right, and the accident
-- reverses if anyone ever writes `Math.abs` into the age helper. `1900-01-01`
-- is the lower bound because the oldest verified human lived to 122.
--
-- WHY the upper bound is a literal rather than `current_date`. A CHECK holding
-- `current_date` is accepted by PostgreSQL and is a footgun: it is STABLE, not
-- IMMUTABLE, so it is evaluated in the SERVER's timezone rather than the user's
-- — which CLAUDE.md #9 forbids for anything calendar-shaped — and existing rows
-- are never rechecked, so the constraint means something different at insert
-- time than it does afterwards.
--
-- So the database holds a bound that cannot rot, and "not in the future"
-- is checked at the app boundary against the user's own local date. That is the
-- same split `users.timezone` already documents: some things Postgres cannot
-- check, and the action is the only place they can be.

-- The drop makes this file rerunnable, matching the two constraints above.
-- It is a new name, so nothing is being replaced today.
alter table public.users
  drop constraint if exists users_birth_date_range;

alter table public.users
  add constraint users_birth_date_range
  check (birth_date >= date '1900-01-01' and birth_date <= date '2100-01-01');

-- WHAT THIS DOES NOT DO, stated because a reader will assume it does: it does
-- not stop a future birth date. It NARROWS the range from "any year" to "before
-- 2100", which still admits ~74 years of them, every one yielding a negative
-- age. app/settings/actions.ts rejects the future against the user's own local
-- date; a direct PATCH to /rest/v1/users skips that, exactly as
-- 20260908090300_validate_user_timezone.sql documents for `timezone`. The
-- consequence today is benign — a negative age trips the under-18 refusal — but
-- that is right by accident, and ADR 0024's table says so rather than claiming
-- a control.
