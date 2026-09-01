-- Samson 0011 — make the anon revoke apply to future tables too
--
-- INVARIANT: RLS is on for every table and anon holds no DML — CLAUDE.md #10
--
-- WHY this exists: migration 0006 ends with
--
--     revoke select, insert, update, delete on all tables in schema public from anon;
--
-- and `on all tables` is a SNAPSHOT of the tables that existed when it ran, not
-- a standing rule. Its grant counterparts were paired with `alter default
-- privileges` so later migrations inherit them; the revoke was not. Supabase's
-- own default privileges grant anon on every newly created table, so
-- user_equipment (0008) and plan_runs (0009) were both created with anon DML
-- and nothing took it away.
--
-- Nothing was reachable through it — anon has no policy on any table, so RLS
-- denied every row regardless. That is the point of the invariant rather than a
-- reason to shrug: grants and policies are independent gates, and a future
-- policy written for authenticated users would have silently become a public
-- read on those two tables.
--
-- Found by tests/db/schema-invariants.test.ts on the first CI run of the `db`
-- job, in PR #2. It had been true since phase 1 and was invisible because that
-- job had never executed.

revoke select, insert, update, delete on all tables in schema public from anon;

-- AI-NOTE: this is the half that was missing. Without it, the next `create
--          table` in this schema arrives with anon DML again and the same
--          defect reappears silently. Any future revoke needs the same pairing.
alter default privileges in schema public
  revoke select, insert, update, delete on tables from anon;
