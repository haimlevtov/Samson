-- Samson 0075 — the account the sign-in page fills in gets $2.00 a week
--
-- ADR 0026's 2026-09-13 amendment, committed first. On the owner's instruction,
-- so the lecturer can evaluate the app without meeting the weekly ceiling. Every
-- other account keeps the column's default.
--
-- WHY by address, and why this is not the mistake 20260912200000 retired: that
-- migration took the demo reset off `auth.users.email` because a check that runs
-- on every call can be satisfied by registering the address. This runs ONCE,
-- against the row the seeder already created on hosted, and nothing afterwards
-- reads an address to decide a budget.
--
-- On a fresh stack it updates nothing — `npm run migrate` runs before
-- `npm run seed` — so the seeder writes the same figure from the archetype.
--
-- `guard_llm_budget` (20260912090000) lets this through: it refuses only
-- `authenticated`, and a migration runs as the database owner.
--
-- AI-NOTE: the address and the figure are EVALUATOR_EMAIL and
--          EVALUATOR_WEEKLY_BUDGET_USD in src/seed/archetypes.ts, and
--          tests/unit/invariants.test.ts fails while the latest migration that
--          sets a ceiling disagrees with them. Do not copy this lookup into a
--          later one: by then the address is only a claim — ADR 0026's
--          amendment says how to change or revert the figure.

update public.users
   set llm_weekly_budget_usd = 2.00
 where user_id = (select id from auth.users where email = 'beginner@samson.test');
