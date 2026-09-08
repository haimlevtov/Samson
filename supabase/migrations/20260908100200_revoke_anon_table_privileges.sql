-- Samson 0042 — anon holds TRUNCATE on every table, and always has
--
-- FOUND IN REVIEW, 2026-09-08, on a branch about tonnage comparisons. It has
-- nothing to do with that feature and is fixed here anyway, because a standing
-- TRUNCATE grant to the signed-out role is not something to leave behind a
-- suggestion chip.
--
-- MEASURED against the hosted project before the change:
--
--   privilege_type | tables
--   ---------------+-------
--   REFERENCES     |     18
--   TRIGGER        |     18
--   TRUNCATE       |     18
--
-- WHY nothing noticed: migrations 0006 and 0011 revoke `select, insert, update,
-- delete` from anon — four verbs — while Supabase's stock default privileges
-- grant seven. And tests/db/schema-invariants.test.ts filters its assertion to
-- the same four:
--
--   and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
--
-- so the test that exists to prove "anon holds nothing" could not see the three
-- it holds. The filter and the revoke were written from the same assumption, so
-- one confirmed the other. That test is widened in the same change.
--
-- WHY TRUNCATE is the one that matters: it is not a DML statement and RLS does
-- not filter it. A policy cannot make a TRUNCATE return fewer rows; it empties
-- the table. Every other protection in this schema is a row-level one, so this
-- is the single grant in the list that no policy anywhere would have caught.
--
-- WHAT WAS ACTUALLY REACHABLE: nothing, today. PostgREST exposes no TRUNCATE
-- verb, so there is no request that reaches it, and anon cannot open a direct
-- Postgres connection. This is the same shape as migration 0011's finding —
-- unreachable through the current front door, and exactly the kind of grant
-- that becomes reachable the moment somebody adds a function, an extension or
-- an admin surface. CLAUDE.md #10 and migration 0006's own header both say anon
-- gets "nothing, on purpose". It did not.
--
-- `authenticated` is included for the same reason at a lower stakes: it holds
-- TRUNCATE too, and no policy would filter that either. It keeps the four DML
-- verbs it actually uses.
--
-- AI-NOTE: both halves, as migration 0011 had to learn. `on all tables` is a
--          SNAPSHOT of the tables that exist right now; the `alter default
--          privileges` is what makes it a standing rule for tables added later.
--          A revoke without its default-privileges pair reintroduces this on
--          the next `create table`.

revoke truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon;

alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;
