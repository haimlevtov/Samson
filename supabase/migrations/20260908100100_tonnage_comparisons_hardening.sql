-- Samson 0041 — three corrections to the table added an hour earlier
--
-- ALL FOUND IN REVIEW, 2026-09-08, before any of it shipped to a user.
--
-- WHY a second migration rather than editing 20260908100000: that file is
-- already applied. Editing an applied migration makes the recorded history
-- describe SQL that was never run, which is a desync this project has repaired
-- by hand twice.

-- ---------------------------------------------------------------------------
-- 1. The CHECK did not mean what it said: NaN is greater than zero
-- ---------------------------------------------------------------------------
--
-- MEASURED against the hosted project: `select ('NaN'::numeric > 0)` returns
-- TRUE. PostgreSQL orders NaN as greater than every non-NaN numeric so that it
-- can be indexed and sorted, and precision and scale are not applied to it. So
-- `check (mass_kg > 0)` admits a row holding NaN, and PostgREST will cast the
-- JSON STRING "NaN" into the column on the way in.
--
-- Nothing renders it today — compareTonnage skips any candidate failing
-- Number.isFinite, deliberately, and src/metrics/comparisons.test.ts covers
-- that case. What was wrong is the STATED guarantee: the comment in that file
-- cited this constraint as the reason a mass is usable, and the next consumer
-- to trust it — an avg(mass_kg), a chart, a reader that does not repeat the
-- isFinite guard — would inherit a poisoned value from a constraint that looks
-- like it forbids one.
--
-- `< 1e10` excludes NaN, because `NaN < 1e10` is false. It also bounds the
-- magnitude, and it costs nothing: numeric(12,2) tops out just under 1e10
-- anyway, and the heaviest row is the Eiffel Tower at 1.01e7.

alter table public.tonnage_comparisons
  drop constraint if exists tonnage_comparisons_mass_kg_check;

alter table public.tonnage_comparisons
  add constraint tonnage_comparisons_mass_kg_check
  check (mass_kg > 0 and mass_kg < 1e10);

-- ---------------------------------------------------------------------------
-- 2. Free text with no ceiling
-- ---------------------------------------------------------------------------
--
-- The house precedent is workout_templates.name (20260905090000):
-- `check (length(btrim(name)) between 1 and 80)`. These three columns had no
-- bound at all, so a row could hold a megabyte string. The longest shipped
-- value is 63 characters.

alter table public.tonnage_comparisons
  add constraint tonnage_comparisons_singular_length
  check (length(btrim(singular)) between 1 and 80),
  add constraint tonnage_comparisons_plural_length
  check (length(btrim(plural)) between 1 and 80),
  add constraint tonnage_comparisons_source_note_length
  check (length(btrim(source_note)) between 1 and 200);

-- ---------------------------------------------------------------------------
-- 3. A write policy with no feature behind it
-- ---------------------------------------------------------------------------
--
-- The table shipped with the catalogue policy PAIR, because ADR 0002 says every
-- catalogue table repeats it. Re-reading the ADR's reason: the write half exists
-- so that "user-authored custom exercises work later with no migration" — it is
-- justified by a named future feature.
--
-- There is no such feature here, and there is not going to be one. This is a
-- shared ladder of jokes, not personal content: nothing in the app offers to
-- create a comparison object and nothing would read one back except its own
-- author's Profile. So the pair granted INSERT on this table to every
-- authenticated user in exchange for nothing, and PostgREST is a path even
-- where the UI is not. Ten thousand posted rows would sit in a shared free-tier
-- database forever.
--
-- DEVIATION FROM ADR 0002, recorded there as well as here. The ADR's AI-NOTE
-- says to copy both policies "or the rows become invisible, or writable by the
-- wrong user". Dropping the write policy cannot make rows writable by the wrong
-- user — it makes them writable by nobody, which is what shared authored
-- content should be. The read policy stays exactly as it is, so the rows are
-- still visible and tests/db/schema-invariants.test.ts still finds a policy.
--
-- AI-NOTE: `user_id` stays on the table and stays nullable. It is what makes
--          CLAUDE.md #10 literally true and what the RLS coverage test looks
--          for, and if user-authored objects ever become a feature, the policy
--          comes back rather than the column.

drop policy if exists tonnage_comparisons_write on public.tonnage_comparisons;

-- INVARIANT: RLS and grants are two independent gates — ADR 0003. With no write
-- policy, the DML grants below could never be satisfied anyway; revoking them is
-- the second gate closing behind the first, and it is the pattern
-- 20260907180100 established — revoke from all three before granting, so the
-- result is readable here rather than inferred from two migrations two weeks
-- apart.
revoke all on public.tonnage_comparisons from public, anon, authenticated;
grant select on public.tonnage_comparisons to authenticated;
