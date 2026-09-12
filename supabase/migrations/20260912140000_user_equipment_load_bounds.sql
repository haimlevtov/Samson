-- Samson 0063 — an upper bound on max_load_kg, before the app writes it
--
-- ADR 0029. `user_equipment.max_load_kg` has existed since
-- 20260825071917_user_equipment.sql and only `scripts/seed.ts` has ever written
-- it. The settings picker starts writing it in this same PR, so — exactly as
-- 20260909120000 argued for the four biometric columns — this is the last moment
-- the constraint can be tightened without a backfill.
--
-- FOUND IN REVIEW, which is worth recording: ADR 0029 originally claimed "no
-- migration" on the strength of the two RLS policies, both of which are indeed
-- sufficient. It had not examined the CHECK.
--
-- ---------------------------------------------------------------------------
-- `check (max_load_kg > 0)` does not exclude NaN, and bounds no magnitude
-- ---------------------------------------------------------------------------
--
-- MEASURED against this hosted project and recorded in
-- 20260908100100_tonnage_comparisons_hardening.sql: `select ('NaN'::numeric > 0)`
-- returns TRUE, because PostgreSQL orders NaN above every non-NaN numeric so it
-- can be indexed. PostgREST casts the JSON string "NaN" into the column on the
-- way in, and `user_equipment_own` lets an authenticated user write their own
-- rows directly — so a hand-written POST could put one there.
--
-- WHAT IT WOULD DO. `max_load_kg` feeds `load_ceiling`, one of the six
-- deterministic planner rules (src/planner/rules.ts). `ceilingFor` takes the
-- MINIMUM of the non-null ceilings, so:
--
--   * A NaN ceiling fails closed by luck. `Math.min(NaN, 30)` is NaN and
--     `heaviest <= NaN` is false, so the rule raises a finding and the plan is
--     rejected. Safe, and not by design.
--   * 9,999.99 — which `numeric(6, 2)` admits — fails OPEN. It is a real number,
--     it becomes the minimum only if it is the smallest, and otherwise it simply
--     never binds. A ceiling that never binds is the same as no ceiling, which
--     is the protection this column exists to provide quietly removed.
--
-- An upper bound excludes NaN as a side effect, because `NaN <= 1000` is false,
-- and bounds the magnitude at the same time — the same two-for-one the biometric
-- bounds took.
--
-- WHY 1000 and not a type-shaped number: the heaviest plate-loaded machine in a
-- commercial gym is a few hundred kilograms. A human bound, like the
-- biometrics', rather than the column's.
--
-- AI-NOTE: `MAX_LOAD_KG` in src/db/equipment.ts is the same figure in the
--          application, and the two are defence in depth only while they agree.
--          Change both together.

alter table public.user_equipment
  add constraint user_equipment_max_load_bounded
    check (max_load_kg is null or (max_load_kg > 0 and max_load_kg <= 1000));

comment on column public.user_equipment.max_load_kg is
  'The heaviest this implement goes, in kilograms. NULL means no ceiling. Read by the load_ceiling planner rule, which takes the minimum of the non-null ceilings — migration 20260912140000, ADR 0029.';
