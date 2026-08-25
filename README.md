# Samson

Gamified strength-training app with an LLM coach. Class project.

Deterministic code computes all numbers. The LLM interprets them, plans within
validated bounds, and speaks in a persona. It never calculates.

- `CLAUDE.md` — the ten invariants. Read first.
- `docs/PLAN.md` — phases and acceptance criteria. **Current phase: 2.**
- `docs/plans/` — the agent plan for each phase, as approved.
- `docs/adr/` — decisions and the reasoning behind them.

## Prerequisites

Node 22+ and the [Supabase CLI](https://supabase.com/docs/guides/cli). Docker is
optional — see below.

## Setup (hosted, no Docker)

This is the default. The hosted free-tier project already has the full schema.

```bash
npm install
cp .env.example .env.local
```

Fill `.env.local` from the Supabase dashboard (Project settings → API keys):

```
NEXT_PUBLIC_SUPABASE_URL=https://mqcnpuupzknwpvhkbpci.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<secret key — the seeder needs it to create users>
```

Then:

```bash
npm run seed        # five synthetic users, ~1s
npm run dev         # http://localhost:3000
```

Add an [OpenRouter](https://openrouter.ai/keys) key too if you want real model
calls — everything except `npm run smoke:llm` works without one.

New migrations go to the hosted project with `npm run db:push`, after
`supabase link --project-ref mqcnpuupzknwpvhkbpci` once.

## Setup (local stack)

Only worth it when you need to reset the schema repeatedly or run
`npm run test:db`, which requires a direct Postgres connection. Docker's WSL2 VM
holds several GB while it runs.

```bash
supabase start                 # prints the local URL and keys for .env.local
npm run migrate && npm run seed
```

**Stop it when you are done** — `supabase stop` alone reclaims almost nothing:

```bash
supabase stop && wsl --shutdown
```

## Scripts

| Command                                 | What it does                                                |
| --------------------------------------- | ----------------------------------------------------------- |
| `npm test`                              | Unit tests. No database, no network, no API key.            |
| `npm run test:db`                       | RLS and schema tests against the local stack.               |
| `npm run migrate`                       | `supabase db reset` — local stack only, rebuilds from zero. |
| `npm run db:push`                       | Applies new migrations to the hosted project.               |
| `npm run seed`                          | Five synthetic users with 8+ weeks of history.              |
| `npm run inspect:seed`                  | Prints each archetype progression for eyeballing.           |
| `npm run catalogue:fetch`               | Refreshes the committed exercise snapshot.                  |
| `npm run smoke:llm`                     | One real model call. Spends money. Never runs in CI.        |
| `npm run typecheck` / `lint` / `format` | The rest of what CI checks.                                 |

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
