# Samson

Gamified strength-training app with an LLM coach. Class project.

Deterministic code computes all numbers. The LLM interprets them, plans within
validated bounds, and speaks in a persona. It never calculates.

- `CLAUDE.md` — the ten invariants. Read first.
- `docs/PLAN.md` — phases and acceptance criteria. **Current phase: 0.**
- `docs/plans/` — the agent plan for each phase, as approved.
- `docs/adr/` — decisions and the reasoning behind them.

## Prerequisites

Node 22+, Docker Desktop (running), and the [Supabase CLI](https://supabase.com/docs/guides/cli).

## Setup

```bash
npm install
cp .env.example .env.local
supabase start
```

`supabase start` prints the local URL and keys. Put them in `.env.local`, then
add an [OpenRouter](https://openrouter.ai/keys) key if you want to make real
model calls — everything except `npm run smoke:llm` works without one.

```bash
npm run migrate     # rebuild the schema from zero
npm run dev         # http://localhost:3000
```

## Scripts

| Command                                 | What it does                                         |
| --------------------------------------- | ---------------------------------------------------- |
| `npm test`                              | Unit tests. No database, no network, no API key.     |
| `npm run test:db`                       | RLS and schema tests against the local stack.        |
| `npm run migrate`                       | `supabase db reset` — rebuilds the schema from zero. |
| `npm run smoke:llm`                     | One real model call. Spends money. Never runs in CI. |
| `npm run typecheck` / `lint` / `format` | The rest of what CI checks.                          |

After changing a migration, regenerate the types or CI will fail:

```bash
supabase gen types typescript --local > src/db/types.ts
```

## Layout

```
app/                     Next.js. /api/health is the keep-alive cron target.
src/llm/gateway.ts       The only door to OpenRouter — CLAUDE.md #2.
src/llm/models.ts        Model fallback array per pipeline stage.
src/db/ledger.ts         The only Postgres-backed LedgerClient.
supabase/migrations/     Schema. RLS is enabled in the same file as each table.
tests/unit/              Executable invariants — greps the tree for violations.
tests/db/                Cross-user isolation and structural schema assertions.
```

## Phase 0 acceptance criteria

| Criterion                                        | How to check                         |
| ------------------------------------------------ | ------------------------------------ |
| Tests pass with no secrets                       | `npm test` with an empty environment |
| A gateway call writes a complete `llm_calls` row | `npm run smoke:llm`                  |
| User A cannot read user B's rows                 | `npm run test:db`                    |
| `npm run migrate` rebuilds from zero             | `npm run migrate && npm run test:db` |

## Deploying

Connect this repo in the Vercel dashboard, then set:

| Variable                        | Where it comes from                             |
| ------------------------------- | ----------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project settings                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable/anon key                   |
| `OPENROUTER_API_KEY`            | openrouter.ai/keys                              |
| `OPENROUTER_APP_URL`            | your deployment URL (optional, for attribution) |

The `keepalive` workflow needs `SUPABASE_URL` and `SUPABASE_ANON_KEY` as GitHub
Actions secrets, and optionally `APP_HEALTH_URL` pointing at
`https://<deployment>/api/health`.

## Local notes

The `[analytics]` container is disabled in `supabase/config.toml`: it requires
the Docker daemon exposed on `tcp://localhost:2375` on Windows, and nothing in
this project uses it.
