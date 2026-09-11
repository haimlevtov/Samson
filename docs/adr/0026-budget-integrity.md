# ADR 0026 — The weekly LLM budget cannot be moved by its owner

**Status:** accepted, rework plan PR 6c
**Date:** 2026-09-12

> Written before the code it governs, in its own commit.

## Context

Every model call goes through one gate: `enforceBudget` in `src/llm/gateway.ts`
compares the user's spend over the trailing week (`sumSpendSince`,
`src/db/ledger.ts`) with their ceiling (`users.llm_weekly_budget_usd`, $0.50 by
default), and refuses at or past it. Since ADR 0025 the key is funded and a
coach's voice is one press away, and that gate is the only thing between a
signed-in user and the project's OpenRouter credit.

The security review of #49 found four ways the gate's owner — the user it
limits — can move it. All four are older than ADR 0025; none needed its code.

1. **Raise the ceiling.** `authenticated` holds table-wide UPDATE on
   `public.users` (ADR 0003) and `users_update_own` allows it, so one
   `PATCH /rest/v1/users {"llm_weekly_budget_usd": 999999}` lifts it.
   `users_insert_own` lets a user choose it when the row is created, too. The
   only check is `>= 0`, which `NaN` passes, because Postgres sorts NaN above
   every number.
2. **Cancel spend with planted rows.** `llm_calls_insert_own` lets a user insert
   their own ledger rows with any values. A negative or NaN `cost_credits`
   cancelled a week of spend until #49's clamp; a `created_at` in 2099 keeps a
   row in every future window; and because `sumSpendSince` fetches rows and sums
   them in JavaScript, a thousand planted zero-cost rows push real spend past
   PostgREST's 1,000-row cut, where it is never counted.
3. **Spend without a profile row.** Nothing creates a `public.users` row at
   sign-up; the seeder and the tests do. A caller without one got the default
   budget, their paid call went out, and every ledger insert then failed its
   foreign key — spend nobody recorded and the gate never saw.
4. **Spend in parallel.** The gate reads spend before a call and the row lands
   after it, so requests sent at once all pass. ADR 0015 §5 and ADR 0024
   already say so.

Checked on hosted before this ADR: no negative or NaN costs, no future-dated
rows, every budget at the default, and no auth user without a profile — so the
constraints below apply without a backfill.

## Decision

**The ceiling and the ledger belong to the project, not to the user they
limit.**

1. **The ceiling is set by the database, not its owner.** A trigger on
   `public.users`, before insert and update: a row inserted by `authenticated`
   is given the default ceiling whatever it asked for, and an update by
   `authenticated` that changes the ceiling is refused. The seeder and an operator — the
   service role — can still set it. A CHECK adds "and not NaN".
   - **The trigger writes the figure, it does not read the column's default.**
     A `BEFORE INSERT` trigger runs after the default has already been
     substituted, so there is nothing left to distinguish "the user asked for
     0.50" from "the user asked for nothing". It restates the literal, which
     makes $0.50 live in two places — the column default and the trigger body —
     carrying an AI-NOTE in the migration to change both together.
   - **Why a trigger, not a column privilege:** a column-level REVOKE does
     nothing while the table-level UPDATE grant stands, and narrowing that grant
     means re-listing every column Settings writes. Migration `20260908090300`
     guards `timezone` the same way.
2. **The ledger cannot cancel spend.**
   - A CHECK on `cost_credits` and `upstream_cost`: null, or at least zero and
     not NaN.
   - A `before insert` trigger sets `created_at` to `now()`: a row is dated by
     the database, never by its writer.
   - **The spend is summed in SQL.** `llm_spend_summary(p_user_id, p_since)`,
     `security invoker` so RLS applies, returns the measured spend and the
     number of rows the gate charges an assumption for — timeouts, and speech
     that reached a 200 with no price. `src/db/ledger.ts` applies the prices
     (`TIMEOUT_ASSUMED_COST_USD`, `SPEECH_ASSUMED_COST_USD`), so the estimates
     stay in config and out of the database. One round trip, no row cap, and a
     flood of zero-cost rows adds nothing.
   - **Why the insert policy stays:** the gateway writes the ledger with the
     user's own client — CLAUDE.md #10 forbids the service role in application
     code — so `llm_calls_insert_own` is how CLAUDE.md #3 holds. What a user can
     still do with it is add to their own spend, which limits nobody but them.
   - **The residual, stated:** unbounded inserts into one's own ledger are still
     free storage and free CPU on every later sum. Nothing here rate-limits
     them. It is self-denial rather than a bypass — the rows raise the writer's
     own spend and close their own gate — so it fails in the safe direction, and
     bounding it is a rate limit rather than a constraint.
3. **No profile, no call.** `enforceBudget` refuses a caller whose budget
   lookup finds no row — `NoProfileError`, before any request. The row it would
   write cannot exist: `llm_calls.user_id` references `public.users`. So the
   refusal writes none, and nothing is sent or charged. That is a second place
   where the gateway reads CLAUDE.md #3's "every call" as beginning at a gate it
   could pass — **the owner's to accept or refuse**, as ADR 0025's was.
   `DEFAULT_WEEKLY_BUDGET_USD` goes with the fallback: the default is the
   column's.
   - **What the caller sees:** `NoProfileError` is not classified as a refusal
     cause anywhere yet, so a surface that catches it shows its generic failure
     — the Coach's "that did not come through", the planner's failed run. That
     is honest (the call did fail) but it is not diagnostic, and the path is
     unreachable while the seeder and the tests are the only things making
     profiles. Naming the cause belongs with whatever opens sign-up.
4. **Parallel spend is documented, not reserved.** A reservation — a per-user
   advisory lock and a pending row — is out of proportion for a one-demo project
   (CLAUDE.md, out of scope). The ceiling that bounds a burst is the OpenRouter
   key's own credit limit, which the owner sets.

## Consequences

- **The key may go on Vercel once this is merged and pushed**, with a credit
  limit on it. The README's deploy table says so.
- `llm_calls.created_at` is the database's now, **for every writer including the
  service role** — the trigger has no role exemption, deliberately: a date the
  project itself can forge is one an operator can be talked into forging. A test
  or a backfill that needs an old row inserts it and then UPDATEs `created_at`
  with the service role, which the trigger does not touch because it fires
  `before insert` only. None does today.
- A user can still see and write their own ledger rows, and can only ever
  charge themselves more.
- **Whether sign-up is open on the hosted project is for the owner to check.**
  The app has no sign-up page; with sign-up off, decision 3 guards a path
  nobody can reach.
- ADR 0025's addendum listed these holes as closing here; they are.
