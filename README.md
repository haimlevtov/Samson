# Samson

Gamified strength-training app with an LLM coach. Class project.

Deterministic code computes all numbers. The LLM interprets them, plans within
validated bounds, and speaks in a persona. It never calculates.

- `CLAUDE.md` — the ten invariants. Read first.
- `docs/PLAN.md` — phases and acceptance criteria. **Phase 6 is the last one,
  and it is closed:** five PRs shipped, file import deferred by decision.
- [`docs/plans/`](docs/plans/README.md) — a plan and a recorded outcome per
  phase, plus two documents that are not phase plans. Its README says which is
  which and when each was written, because they are not all the same thing.
- `docs/adr/` — decisions and the reasoning behind them.

## Checking that it works

Everything below except the last command is **free** — no API key, no network,
no database, no spend.

```bash
npm install
npm run verify
```

`verify` runs typecheck, lint, format, the full test suite, and the golden-set
evaluation twice: once with a compliant planner and once with `--naive`, a
planner that breaks every rule. The second run is the interesting one — it must
reject all thirty cases, and reject them by _arithmetic_, before the critic
model is ever consulted.

| What                                           | Command                                              | Cost                         |
| ---------------------------------------------- | ---------------------------------------------------- | ---------------------------- |
| Everything that can be checked without a model | `npm run verify`                                     | **free**                     |
| One real plan, end to end through both models  | `npm run demo:llm`                                   | ~$0.05                       |
| The full live golden set                       | `npm run eval:planner -- --live --all --max-spend 2` | never measured; ~$1 expected |

`demo:llm` is the cheap proof that real models are involved: one case, one
planner call, one critic call, a hard $0.15 abort, and the cost printed at the
end. It needs `OPENROUTER_API_KEY` in `.env.local`.

**The golden-set figure is an estimate, and the row says so because nobody has
run it.** `docs/plans/phase-2.md` records the acceptance rate across all thirty
cases as "still unmeasured live", and puts the cost at roughly $3 — measured when
`DEFAULT_CANDIDATE_LIMIT` was 120. It is 40 now, which `docs/adr/0007-grouped-sets.md`
records as cutting the planner prompt from ~13,000 tokens to ~4,500, so the
per-case cost fell with it. Hence ~$1, and hence an estimate rather than a
number.

`--max-spend 2` is in the command deliberately: the script aborts past **$0.75**
by default, so the row as it stood documented a run that would have stopped
partway through and reported a partial acceptance rate as if it were the real one.

**Why the free path is the important one.** The deterministic floor — six rules
in `src/planner/rules.ts` — is what makes the plans safe, and none of it needs
a model to demonstrate. `npm run verify` proves the rules are jointly
satisfiable on thirty real seeded histories, that a non-compliant block is
rejected before any model judges it, and that the persona layer cannot alter a
number. What a key buys is evidence about the _models_, which is a smaller
question than it sounds.

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
SUPABASE_URL=https://mqcnpuupzknwpvhkbpci.supabase.co
SUPABASE_ANON_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<secret key — the seeder needs it to create users>
```

Then:

```bash
npm run seed        # five synthetic users: history, XP, badges, challenges, templates
npm run dev         # http://localhost:3000
```

Add an [OpenRouter](https://openrouter.ai/keys) key too if you want real model
calls. Without one the app still runs: the coach's delivery, the one question
box, the plan questionnaire and History's free-text log say a key is missing,
and the coach voices show their lines as text. `npm run verify` needs none.

New migrations go to the hosted project with `npm run db:push`, after
`supabase link --project-ref mqcnpuupzknwpvhkbpci` once.

## Setup (local stack)

Only worth it when you need to reset the schema repeatedly. `npm run test:db`
no longer requires it — set `SUPABASE_DB_URL` to the hosted pooler string
(see `.env.example`) and the whole suite runs without Docker. Docker's WSL2 VM
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

| Command                                 | What it does                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `npm test`                              | Unit tests. No database, no network, no API key.                              |
| `npm run test:db`                       | RLS and schema tests. Local stack, or hosted via DB_URL.                      |
| `npm run migrate`                       | `supabase db reset` — local stack only, rebuilds from zero.                   |
| `npm run db:push`                       | Applies new migrations to the hosted project.                                 |
| `npm run seed`                          | Five synthetic users: 8+ weeks of history, XP, badges, challenges, templates. |
| `npm run verify:doi`                    | Resolves every evidence-table DOI against the DOI registry.                   |
| `npm run inspect:seed`                  | Prints each archetype progression for eyeballing.                             |
| `npm run catalogue:fetch`               | Refreshes the committed exercise snapshot.                                    |
| `npm run smoke:llm`                     | One real model call. Spends money. Never runs in CI.                          |
| `npm run typecheck` / `lint` / `format` | The rest of what CI checks.                                                   |

After changing a migration, regenerate the types or CI will fail:

```bash
supabase gen types typescript --local > src/db/types.ts
```

## Layout

```
app/                     Next.js. /api/health is the keep-alive cron target.
app/templates/           Build, save or import a session; start one in a tap.
src/templates/           What a template prescribes, and how much of it was done.
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

Live at **https://samson-fit.vercel.app**, auto-deployed from `main`.

Vercel → Settings → Environment Variables. Copy the first two straight out of
your working `.env.local` so they cannot drift:

| Variable             | Required | Notes                                         |
| -------------------- | -------- | --------------------------------------------- |
| `SUPABASE_URL`       | yes      | Without it every page 500s                    |
| `SUPABASE_ANON_KEY`  | yes      | Publishable/anon key                          |
| `OPENROUTER_API_KEY` | yes      | With a credit limit set on the key — ADR 0026 |
| `OPENROUTER_APP_URL` | optional | Attribution on the OpenRouter dashboard       |

**Set a credit limit on `OPENROUTER_API_KEY` in the OpenRouter dashboard before
it goes on Vercel** — Production and Preview alike. The weekly budget bounds each
signed-in user's spend, and since [ADR 0026](docs/adr/0026-budget-integrity.md)
its owner cannot move it; but requests sent at once all pass the budget before
any of them is recorded, and only the key's own limit bounds a burst.

**WHY no `NEXT_PUBLIC_` prefix:** nothing client-side touches Supabase. The only
client component is the rest timer, and it has no database access — every query
runs in a Server Component, a server action, or `proxy.ts`. The anon key would be
safe to expose (the `anon` role has no policy and no DML grant on any table, both
asserted in `tests/db/schema-invariants.test.ts`), but there is no reason to ship
a value the browser never reads.

**Never set `SUPABASE_SERVICE_ROLE_KEY` in Vercel.** It bypasses RLS, no request
path uses it, and `tests/unit/invariants.test.ts` asserts it never appears under
`src/` or `app/` — CLAUDE.md #10. Only the seeder needs it, and the seeder runs
on your machine.

Vercel applies environment variables at build time, so **redeploy after adding
them** — an existing deployment will not pick them up.

The `keepalive` workflow needs GitHub Actions secrets: `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `APP_HEALTH_URL` set to
`https://samson-fit.vercel.app/api/health`.

## Local notes

The `[analytics]` container is disabled in `supabase/config.toml`: it requires
the Docker daemon exposed on `tcp://localhost:2375` on Windows, and nothing in
this project uses it.
