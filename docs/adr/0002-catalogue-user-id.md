# ADR 0002 — Nullable `user_id` on catalogue tables

**Status:** accepted, phase 0
**Date:** 2026-08-24

## Context

CLAUDE.md #10 says every table has `user_id` and RLS is on everywhere.
CLAUDE.md #7 says content — achievements, personas, exercises, progression
nodes — lives in the database as rows.

These collide. Catalogue rows are shared content owned by nobody, so there is no
user to put in `user_id`. The obvious escapes are both bad: exempting catalogue
tables from #10 turns an invariant into a guideline and leaves the RLS coverage
test with a growing list of special cases, while inventing a system user row
means every catalogue query joins against a fake account.

## Decision

`user_id` is **nullable** on catalogue tables, and `NULL` means system content.
Every catalogue table carries the same policy pair:

```sql
create policy <table>_read on public.<table>
  for select to authenticated using (user_id is null or user_id = auth.uid());
create policy <table>_write on public.<table>
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Read reaches system content plus your own. Write reaches only your own, so no
user can modify or delete shared content.

Uniqueness uses `unique nulls not distinct (user_id, slug)`, so two system rows
cannot share a slug — the default `NULLS DISTINCT` behaviour would let them.

`public.users` names its primary key `user_id` rather than `id` for the same
reason: the invariant is then literally true of every table and the coverage test
in `tests/db/schema-invariants.test.ts` needs no exemptions at all.

## Consequences

- Invariant #10 stays checkable by a query rather than by reading a list.
- User-authored custom exercises work later with no migration — the column and
  the policies already handle them.
- Every new catalogue table must copy both policies. Forgetting the read policy
  makes the rows invisible; forgetting the write policy makes them writable by
  the wrong user. `tests/db/schema-invariants.test.ts` catches a table with no
  policy at all, but it cannot catch a wrong one, so this is called out in an
  `AI-NOTE` at the top of the catalogue migration.
- Hidden achievements ride on this same mechanism: the read policy adds
  `and hidden = false`, which makes PLAN.md's phase 5 requirement structural
  instead of something a future endpoint has to remember. The consequence is that
  server-side unlock evaluation must run in a `SECURITY DEFINER` function, not
  through a user client, or hidden achievements can never fire.
