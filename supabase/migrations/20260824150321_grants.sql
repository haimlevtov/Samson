-- Samson 0006 — role grants
--
-- WHY: table grants and RLS policies are two independent gates, and Supabase
--      grants migration-created tables only REFERENCES/TRIGGER/TRUNCATE by
--      default. Without this file every policy above is unreachable and every
--      query returns "permission denied for table ..." rather than rows.
--
-- INVARIANT: RLS is on for every table — CLAUDE.md #10
-- The grants below are deliberately coarse because RLS, not the grant, decides
-- which rows a user sees. The one thing that must stay narrow is the role list:
--
--   authenticated  full DML, filtered to their own rows by policy
--   service_role   full DML, bypasses RLS — scripts and seeders only
--   anon           nothing, on purpose. There is no anon policy anywhere, so an
--                  anon grant would be dead weight that a future policy could
--                  silently turn into a public data leak.
--
-- AI-NOTE: the default privileges at the bottom cover tables added by later
--          migrations. If you create a table outside this schema, grant it
--          explicitly — tests/db/schema-invariants.test.ts will catch it.

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- Explicitly revoke DML from anon, in case a default privilege ever adds it.
--
-- AI-NOTE: `on all tables` is a SNAPSHOT, not a standing rule — it covers only
--          the tables that exist right now. The grants above are paired with
--          `alter default privileges` so later migrations inherit them; this
--          line was not, so every table created after this migration arrived
--          with anon DML again. Migration 20260901145239 adds the missing
--          default-privileges half. Do not add a revoke here without one.
revoke select, insert, update, delete on all tables in schema public from anon;
