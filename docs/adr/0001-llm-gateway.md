# ADR 0001 — One gateway, injected dependencies, ledger in a `finally`

**Status:** accepted, phase 0
**Date:** 2026-08-24

## Context

CLAUDE.md #2 requires every LLM call to go through `src/llm/gateway.ts`, and #3
requires every call — including failed and retried ones — to write a row to
`llm_calls`. PLAN.md puts this before any agent because the token data from the
whole development period is part of what the project is graded on, and it cannot
be reconstructed after the fact.

Two constraints pull against each other: the ledger write needs a database, and
the phase 0 acceptance criterion says the test suite must pass in CI with no
secrets configured.

## Decision

**All I/O is injected.** `callLLM(options, deps)` takes `fetch`, a clock, a
`sleep`, the API key, and a `LedgerClient` — a three-method interface, not a
`SupabaseClient`. `src/db/ledger.ts` holds the only Postgres-backed
implementation. The unit suite builds the whole dependency object itself and
touches no network, no database, and no key.

**The ledger write lives in a `finally`, one row per attempt.** A retry writes a
second row rather than updating the first, so retry cost is visible in the data
instead of being averaged away.

**A failed ledger write fails the call.** It is not logged and swallowed. A call
that succeeds upstream but leaves no row is unrecoverable data loss, and
under-reported spend is worse than a visible error.

**The budget check runs before the request and logs its denial.** The failure
mode being defended against is a retry loop draining a free tier overnight, so
the check has to precede the spend. A denied call is still a call, so it writes
a `budget_denied` row.

**Both halves of invariant #2 are enforced twice** — an ESLint rule and a test
that greps the source tree. Lint can be silenced with an inline disable comment;
the grep cannot.

## Consequences

- Callers must obtain a `LedgerClient` and pass it in. This is deliberate: it
  keeps the RLS-scoped, per-request Supabase client on the caller's side, so the
  gateway never needs credentials of its own.
- `prompt_prefix_hash` is computed on every call for a phase 2 measurement.
  It costs one hash now and cannot be recovered later.
- Structured output uses `provider.require_parameters: true`, so a request will
  fail to route rather than silently fall back to a model that ignores the
  schema and returns prose.

## Notes

OpenRouter's usage accounting is automatic. The `usage: { include: true }`
parameter PLAN.md refers to is deprecated and has no effect — full usage is
returned on every response. There is no flag to set, which is why there is an
`AI-NOTE` in `src/llm/openrouter.ts` rather than a config option.
