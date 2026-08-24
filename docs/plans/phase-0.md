# Phase 0 — Foundations

## Context

Samson is a gamified strength-training app with an LLM coach, built as a class
project graded partly on the artifact trail and the token ledger. The repo
currently holds `README.md`, `CLAUDE.md`, `docs/PLAN.md`, and one skill file —
no code.

`docs/PLAN.md` orders phases by risk and states the reason phase 0 comes first:
every agent written before the gateway exists is an agent rewritten afterwards,
and the token data from the whole development period is lost. That data is part
of what the project is graded on. So the deliverable here is not features — it
is a schema that will not need retrofitting, a gateway that every later LLM call
routes through, and a ledger that starts accumulating rows on day one.

Nothing in this phase is visible to a user.

### Decisions taken before planning

- **Hosted Supabase project + local dev.** New free-tier project in org
  `ljbsjnpcfqpyrotqgjla` (which currently holds only the unrelated `Tribunal`).
  Day-to-day work runs against the local Docker stack; migrations push to hosted.
- **DB tests as a separate CI job.** `npm test` stays pure unit, no DB, no
  secrets. A second Actions job runs `supabase start` and the RLS suite.
- **Vercel via GitHub integration**, connected by you once in the dashboard.

### One correction to PLAN.md

PLAN.md specifies "usage accounting on". That parameter is deprecated at
OpenRouter — `usage: { include: true }` has no effect, and full usage is
returned on every response automatically. There is no flag to set. This gets an
`AI-NOTE` in the gateway so a future agent doesn't add a config toggle for it.

---

## Build order

Step 2 must precede step 3 — the gateway cannot write a ledger row to a table
that doesn't exist. Everything else inside a step is parallel.

### 1. Repo scaffold

- `package.json`, TypeScript **strict** (`noUncheckedIndexedAccess` on too),
  ESLint flat config, Prettier, Vitest.
- Next.js App Router, minimal: one route, one `/api/health` handler that does a
  trivial authenticated DB read (the cron target in step 5).
- Zod v4 — `z.toJSONSchema()` is built in, so LLM structured output and runtime
  validation share one schema with no extra dependency. Invariant: schemas are
  the source of truth, TS types are `z.infer`, never hand-written.
- `.env.example` listing every variable, no values.

### 2. Database

`supabase/migrations/`, one migration per domain. Every migration enables RLS
and adds policies **in the same file as its `CREATE TABLE`** — no table ever
exists, even for one migration, without RLS.

| Migration           | Tables                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `0001_users`        | `users` (id → `auth.users`, IANA `timezone`, unit prefs, `llm_weekly_budget_usd`, humor opt-in) |
| `0002_catalogue`    | `equipment_tags`, `exercises`, `exercise_equipment`, `progression_nodes`                        |
| `0003_training`     | `workouts`, `sets`                                                                              |
| `0004_gamification` | `personas`, `achievements`, `achievement_events`, `xp_events`, `challenges`                     |
| `0005_llm_calls`    | `llm_calls`                                                                                     |

Conventions enforced by test, not by habit: `kg` / `cm` / `seconds` canonical
(invariant #8), `timestamptz` everywhere (invariant #9), every table has
`user_id` (invariant #10).

**Catalogue tables and invariant #10 — needs an ADR.** Exercises, achievements,
personas, and progression nodes are shared content, but invariant #10 requires
`user_id` on every table. Resolution: `user_id` is nullable on catalogue tables,
`NULL` meaning system content, with policy `user_id IS NULL OR user_id = auth.uid()`.
The invariant stays literally true, and user-authored custom exercises work
later with no migration. Written up as `docs/adr/0002-catalogue-user-id.md`.

`achievements.hidden` gets a policy excluding hidden rows from client selects
now, so phase 5's criterion is structural rather than remembered.

**`llm_calls` — the row shape that must be right today.** Retrofitting it loses
the development-period data that phases 2 and the token-ledger analysis are
graded on:

```
id, user_id, stage, attempt, status,
models_requested[], model_used, openrouter_id,
prompt_tokens, completion_tokens, total_tokens,
cached_tokens, cache_write_tokens, reasoning_tokens,
cost_credits, upstream_cost,
latency_ms, prompt_prefix_hash, error, created_at
```

`status` covers `ok | schema_invalid | http_error | timeout | budget_denied`.
`prompt_prefix_hash` is what makes phase 2's cache-hit-rate measurable against
the static-first prompt layout; it costs one hash now and cannot be recovered
later.

### 3. `src/llm/gateway.ts` — before anything that calls it

Single exported `callLLM<T>()`. All I/O injected (`fetch`, Supabase client,
clock) so unit tests need no network, no DB, and no API key.

Order of operations, each step writing to the ledger:

1. **Budget check** — sum `cost_credits` over the user's last 7 days against
   `users.llm_weekly_budget_usd`. Over budget → write a `budget_denied` row and
   throw. Invariant #3 means the denial is logged too.
2. **Request build** — `max_tokens` always set (no unbounded call path exists),
   `models` fallback array, `response_format` JSON schema derived from the Zod
   schema.
3. **Call**, with timeout.
4. **Validate** with the same Zod schema.
5. **Retry** with backoff — schema failures re-prompt with the validation error
   attached; transport failures retry plain. Hard attempt cap.
6. **Ledger write, one row per attempt**, in a `finally` — a failed call that
   writes no row is the bug this design exists to prevent.

Ledger writes use the request-scoped, RLS-respecting client. No service role in
application code (invariant #10).

Model slugs live in `src/llm/models.ts` as config, verified against
OpenRouter's `/models` endpoint at implementation time rather than typed from
memory. Phase 2 tunes the cascade; phase 0 just needs a cheap default and one
fallback.

**Both invariants get executable enforcement, not prose:**

- ESLint `no-restricted-syntax` blocking `fetch` to OpenRouter outside
  `src/llm/`, plus a test that greps the source tree — invariant #2.
- A SQL test asserting every `public` table has `rowsecurity = true` and a
  `user_id` column — invariant #10.

These two tests are the cheapest thing in the phase and the reason the
invariants survive contact with fifty future commits.

### 4. Tests

- **Unit** (`npm test`, no secrets, no DB): gateway retry, fallback, budget
  denial, schema-invalid handling, timeout — each asserting the exact ledger
  rows written. Fake `fetch` returns canned OpenRouter payloads including the
  cached-token and cost fields.
- **DB** (`npm run test:db`, local stack): migrate from zero; user A cannot read
  user B's rows across every table; the two invariant-enforcement assertions.
- **Live smoke** (`npm run smoke:llm`, never in CI): one real call, prints the
  resulting `llm_calls` row. This is what demonstrates acceptance criterion 2.

### 5. CI and keep-alive

- `.github/workflows/verify.yml` — job `verify` (typecheck, lint, `npm test`)
  with no secrets available to it; job `db` (`supabase start`, migrate, RLS
  suite).
- `.github/workflows/keepalive.yml` — daily cron hitting `/api/health` so the
  free-tier project never sleeps before a demo.

### 6. Deploy and artifact trail

- You connect `haimlt1995/Samson` in Vercel; I hand you the exact env var list.
- `docs/plans/phase-0.md` — this plan, committed as the artifact trail.
- `docs/adr/0001-llm-gateway.md`, `0002-catalogue-user-id.md`.

---

## Verification — mapped to the acceptance criteria

| Criterion                                               | Proof                                                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test` passes in CI with no secrets                 | `verify` job runs with no secrets in scope; a test asserts the gateway throws a clear error rather than hanging when the key is absent |
| Scripted gateway call writes a complete `llm_calls` row | `npm run smoke:llm` prints the row — prompt, completion, cached counts, and `upstream_inference_cost` all populated                    |
| User A cannot read user B's rows                        | `npm run test:db` — two seeded users, cross-read asserted empty on every table                                                         |
| `npm run migrate` rebuilds from zero                    | `supabase db reset` against an empty local DB, then the invariant assertions run green                                                 |

---

## Deferred, deliberately

Seeder, metrics, planner, personas — phases 1–3. Per CLAUDE.md's out-of-scope
list: no caching layer, queue, real-time sync, push notifications, payments,
containers beyond local Supabase, or load testing.

## Needs you

- **OpenRouter API key** in `.env.local` — I will not ask you to paste it here.
- **Vercel dashboard link-up** once the app builds, with the env list I provide.

---

## Outcome — 2026-08-24

Recorded against the approved plan above. Deviations are the interesting part of
an artifact trail, so they are listed rather than quietly folded in.

### Done and verified

| Acceptance criterion                             | Status                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm test` passes with no secrets                | **Verified.** 20 tests, run with every secret unset in the environment.                                                                          |
| A gateway call writes a complete `llm_calls` row | **Implemented, not yet run live.** Blocked on an OpenRouter key. The row shape is asserted field-by-field in unit tests against canned payloads. |
| User A cannot read user B's rows                 | **Verified.** 19 DB tests covering read, write, update and delete across every table.                                                            |
| `npm run migrate` rebuilds from zero             | **Verified.** Seven migrations apply in order into an empty database.                                                                            |

Hosted project `mqcnpuupzknwpvhkbpci` (eu-central-1) created and migrated.
Supabase's security advisor reports zero findings.

### Deviations from the plan

1. **A seventh migration, `grants`, was not in the plan.** Every policy was
   correct and every query still failed with `permission denied`. Table grants
   and RLS are independent gates, and this CLI version grants migration-created
   tables no DML at all. Written up as `docs/adr/0003-grants-and-rls.md`, since
   the symptom points at the wrong layer and would cost someone an afternoon.

2. **An eighth migration pins `search_path` on the trigger function.** Found by
   running Supabase's database linter against the hosted project — the only
   finding, now zero. A regression test covers it.

3. **Migration filenames were renamed to match the hosted versions.** The schema
   was applied to the hosted project through the management API, which assigns
   its own version timestamps. Left alone, a later `supabase db push` would have
   treated all seven local files as unapplied and failed on duplicate objects.
   Local and remote histories are now identical.

4. **The local `[analytics]` container is disabled.** It requires the Docker
   daemon exposed on `tcp://localhost:2375` on Windows, and nothing uses it.

5. **`prompt_prefix_hash` and the split cache columns were kept**, as planned.
   Worth restating because they are the two things that cannot be backfilled:
   phase 2's cache-hit-rate measurement depends on both.

### Still open

- `npm run smoke:llm` needs `OPENROUTER_API_KEY` in `.env.local`.
- Vercel: connect the GitHub repo, then set the env vars listed in the README.
- GitHub Actions secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` for `keepalive`,
  and optionally `APP_HEALTH_URL` once a deployment exists.
- Neither workflow has run yet — nothing has been pushed.
