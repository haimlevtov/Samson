# ADR 0003 — Table grants are a second gate, and Supabase does not set them

**Status:** accepted, phase 0 — amended 2026-09-08 and 2026-09-11
**Date:** 2026-08-24

## Context

Every table had RLS enabled and correct policies, and every query from a signed-in
user still failed with `permission denied for table users`.

RLS decides _which rows_ a role may touch. A `GRANT` decides whether the role may
touch the table at all. They are independent, and RLS is only consulted once the
grant lets the query through.

Tables created by migrations in this Supabase CLI version receive only
`REFERENCES`, `TRIGGER`, and `TRUNCATE` for `anon`, `authenticated`, and
`service_role` — no `SELECT`, `INSERT`, `UPDATE`, or `DELETE`. Nothing warns
about this. The failure appears at the first query, and it looks like a policy
bug, which is the wrong place to spend an afternoon.

## Decision

An explicit grants migration, `20260824150321_grants.sql`:

- `authenticated` gets full DML on all tables. RLS, not the grant, decides rows.
- `service_role` gets full DML. It bypasses RLS by design and is for scripts and
  seeders only — never application code, per CLAUDE.md #10.
- `anon` gets nothing, and DML is explicitly revoked. There is no anon policy
  anywhere, so an anon grant would be dead weight that a future policy could
  silently convert into a public read.
- `ALTER DEFAULT PRIVILEGES` covers tables added by later migrations, so the next
  person does not have to know any of this.

Three tests in `tests/db/schema-invariants.test.ts` hold the line: every table
grants `SELECT` to `authenticated`, `anon` holds nothing at all, and
`authenticated` holds nothing beyond the four DML verbs its policies are written
against.

> **Amended 2026-09-08, because the second of those used to say "no DML" and
> that was not the same claim.** The Context above names `REFERENCES`, `TRIGGER`
> and `TRUNCATE` as part of what Supabase grants, and the revoke in migration
> 0006 covered `select, insert, update, delete` — four of seven. So did the
> test, filtering `privilege_type in ('SELECT','INSERT','UPDATE','DELETE')`. The
> test and the revoke were written from the same assumption and each confirmed
> the other, and `anon` held `TRUNCATE`, `REFERENCES` and `TRIGGER` on all
> eighteen tables from phase 0 until this amendment.
>
> **TRUNCATE is the one that mattered.** It is not DML, so no policy filters it
> — a policy cannot make a TRUNCATE affect fewer rows, it empties the table.
> Every other protection in this schema is row-level, so it was the single grant
> in the list that nothing else in the design would have caught. Nothing could
> reach it: PostgREST exposes no TRUNCATE verb and `anon` cannot open a direct
> connection. That is the same shape as migration 0011's finding — unreachable
> through the current front door, and exactly the kind of grant that becomes
> reachable the day somebody adds a function or an admin surface.
>
> Fixed in migration `20260908100200`, with the `alter default privileges` half
> that makes it apply to tables added later — the pairing migration 0011 had to
> learn. The test now asserts over **every** privilege type, so the next verb
> added to Supabase's defaults cannot arrive unnoticed.

> **Amended 2026-09-11 — a foreign key is a gate RLS does not guard.** A write
> policy's `with check` sees the row being written. The foreign keys on that row
> are checked by Postgres as the **referenced table's owner, not under RLS**, so
> they resolve another user's row without complaint. Twice now a write policy
> has checked `user_id = auth.uid()` and nothing about the row a foreign key
> points at:
>
> - `sets.workout_id` — a set hung off another user's workout (migration
>   `20260908140000`).
> - `workouts.template_id` and `workout_template_items.template_id` — a session
>   started from, or an item written into, another user's template. Two comments
>   in the code said RLS refused this. It did not.
>
> **The rule.** A write policy on a table with a foreign key into a user-ownable
> table checks, in `with check`, that the referenced row is one the writer may
> use: their own, or a shared catalogue row whose `user_id` is null. `using` is
> left alone, as the first fix argued — adding the clause there would hide a row
> already written across the boundary instead of leaving it visible to the user
> who has to clean it up.
>
> **Held by a test rather than by memory.** `tests/db/schema-invariants.test.ts`
> reads every foreign key from the catalogue and fails on one whose table has a
> user write policy that never mentions it — calibrated against
> `sets.workout_id`, which it must report as checked. Five were unchecked when it
> was written: `sets.exercise_id`, `workout_template_items.exercise_id`,
> `exercise_equipment.exercise_id` and `.equipment_tag_id`, and
> `user_equipment.equipment_tag_id`. All five point at tables that hold shared
> catalogue rows as well as user-owned ones — the same existence-oracle class,
> with no cross-user read today. They are pinned in the test as a known list
> rather than fixed here, so a sixth fails CI and fixing one changes the list on
> purpose.

## Consequences

- Coarse grants mean a policy mistake is the only thing standing between a user
  and someone else's row. That is already true of any RLS design, and it is why
  the cross-user suite in `tests/db/rls.test.ts` tests reads, writes, updates,
  and deletes rather than reads alone.
- The health endpoint deliberately queries as `anon` and expects a permission
  error. The round trip is what keeps the project awake; the denial is proof the
  gate works. See `app/api/health/route.ts`.
