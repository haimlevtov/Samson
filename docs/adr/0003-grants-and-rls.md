# ADR 0003 — Table grants are a second gate, and Supabase does not set them

**Status:** accepted, phase 0
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

Two tests in `tests/db/schema-invariants.test.ts` hold the line: every table
grants `SELECT` to `authenticated`, and no table grants any DML to `anon`.

## Consequences

- Coarse grants mean a policy mistake is the only thing standing between a user
  and someone else's row. That is already true of any RLS design, and it is why
  the cross-user suite in `tests/db/rls.test.ts` tests reads, writes, updates,
  and deletes rather than reads alone.
- The health endpoint deliberately queries as `anon` and expects a permission
  error. The round trip is what keeps the project awake; the denial is proof the
  gate works. See `app/api/health/route.ts`.
