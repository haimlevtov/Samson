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
  the policies already handle them. _Not quite: see the 2026-09-11 amendment._
- Every new catalogue table must copy both policies. Forgetting the read policy
  makes the rows invisible; forgetting the write policy makes them writable by
  the wrong user. `tests/db/schema-invariants.test.ts` catches a table with no
  policy at all, but it cannot catch a wrong one, so this is called out in an
  `AI-NOTE` at the top of the catalogue migration. _Not quite: the 2026-09-08
  amendment below drops the write half where no feature needs it, and the
  2026-09-11 one adds a check it must carry on a table with a foreign key._

  **Amended 2026-09-08 — the write half needs a feature behind it.** The reason
  given for it above is that "user-authored custom exercises work later with no
  migration": it is justified by a named future feature, not by symmetry.
  `tonnage_comparisons` copied the pair verbatim and there is no such feature
  for it — nothing in the app offers to author a comparison object, and a
  user-owned one would be read back by nobody but its author. So the pair
  granted `INSERT` on that table to every authenticated session in exchange for
  nothing, and PostgREST is a path whether or not the UI has a button.

  The write policy was dropped there, and the DML grant revoked with it. That
  is not a hole in the rule above: dropping it cannot make rows writable by the
  wrong user, it makes them writable by nobody, which is what shared authored
  content should be. The read policy is unchanged and the `user_id` column
  stays — it is what makes CLAUDE.md #10 literally true and what the RLS
  coverage test looks for.

  **The test to write when copying the pair** is the one that was missing:
  assert that an authenticated session cannot insert a row with a null
  `user_id`. That is the escalation the `WITH CHECK` exists to stop — a
  self-only row promoted into content served to every user — and no catalogue
  table asserted it before `tests/db/comparisons.test.ts`.

- Hidden achievements ride on this same mechanism: the read policy adds
  `and hidden = false`, which makes PLAN.md's phase 5 requirement structural
  instead of something a future endpoint has to remember. The consequence is that
  server-side unlock evaluation must run in a `SECURITY DEFINER` function, not
  through a user client, or hidden achievements can never fire.

  **Amended 2026-09-08.** "Structural instead of something a future endpoint has
  to remember" is still true of **locked** definitions, and there is now exactly
  one endpoint that returns held ones —
  [ADR 0017](0017-held-hidden-achievements.md) — because the same clause was
  also hiding badges from the people who had earned them. The policy is
  unchanged; the exception is a single parameterless definer function rather
  than a relaxation of the rule, precisely so that this sentence keeps holding
  for everything else.

## Amended 2026-09-11 — the write half is not enough on a table with a foreign key

The `with check (user_id = auth.uid())` above says whose row it is. It says
nothing about the rows that row points at, and a foreign key is checked as the
referenced table's owner rather than under RLS. So on a catalogue table with a
foreign key into another ownable table, copying the pair verbatim lets a user
link their row to somebody else's. `exercise_equipment_write` is exactly that
copy, and both of its foreign keys are on the pinned list in
`tests/db/schema-invariants.test.ts`. ADR 0003's 2026-09-11 amendment states the
rule a new catalogue table has to follow instead.

The consequence above that the schema test "cannot catch a wrong one" is now
half true: it still cannot judge a policy in general, but it does catch a write
policy that never mentions a foreign key's column and the table it references.
That is a text match, and so a proxy, as ADR 0003 says: a policy that names both
without an ownership clause still passes, and `tests/db/rls.test.ts` is where
the behaviour is tried.

The consequence that custom exercises "work later with no migration" was wrong
for the same reason. `sets` and `workout_template_items` needed
`20260911100000`: until then both accepted a row pointing at another user's
custom exercise, and the `five-patterns` badge read its movement pattern across
users. `exercise_equipment` still accepts one, and is pinned as above.
