# 0009 — Where the gamification guarantees live

Status: accepted
Date: 2026-09-02
Refines: [0003](0003-grants-and-rls.md)
Governs: `src/gamification/`, the phase 4 migrations

## Context

Phase 4's acceptance criteria include two that are security claims rather than
feature claims:

- **"No completion can be granted from the client."**
- **"No sequence of sessions can breach the ceiling."**

Both are the kind of statement that is easy to satisfy in the happy path and
easy to lose to a later refactor. A guarantee that lives only in the one code
path that happens to implement it today is not a guarantee; it is a habit.

Phase 0 already did half the work. `xp_events` and `achievement_events` were
created with **read-only RLS policies and no write policy at all**, so no
authenticated session can insert into either table — including the application's
own session. Writes must therefore come from somewhere else, and this ADR
decides where.

## Decision

### 1. XP is written by `SECURITY DEFINER` functions, never by a user session

`award_session_xp(p_workout_id uuid)` takes **a workout id and nothing else**.
Every number it writes it derives from rows already in the database: it checks
the workout belongs to `auth.uid()` and is `completed`, counts the week's kept
sessions, and computes the award.

**Nothing the caller sends becomes an amount.** There is no `p_amount`
parameter, deliberately — an RPC that accepted one would move the trust boundary
into the browser no matter how carefully the caller behaved.

### 2. The weekly ceiling is a database trigger, not only application arithmetic

`src/gamification/xp.ts` computes and clamps the award. A `before insert`
trigger on `xp_events` **independently** refuses any row that would push
`sum(amount)` for `(user_id, week_start)` past `WEEKLY_XP_CEILING`.

This is the same shape as the planner in ADR 0004: the TypeScript is the policy,
the database is the floor. In normal operation the trigger never fires, because
the clamp got there first — so a test forces it to fire, by inserting past the
cap as the service role with the application bypassed entirely.

**Why duplicate the number at all:** the ceiling is the one figure a bug, a
migration, a future RPC, or a careless admin script could breach without
anything noticing, and the damage is silent — a user with more XP than the rules
allow, discovered whenever someone next looks. A single line of SQL closes that
permanently, and the phase criterion says "no sequence", not "no sequence via
the intended path".

The constant is defined once in TypeScript and asserted against the database in
`tests/db/`, so the two cannot drift without a test failing.

### 3. Achievement predicates execute only for system-owned rows

This is the decision with teeth, and it exists because of a hole that is
reachable today.

`achievements.predicate` is **SQL text stored in a table**, and evaluating an
achievement means running that text. The phase 0 policy `achievements_write`
lets any authenticated user insert their **own** achievement row:

```sql
create policy achievements_write on public.achievements
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

An evaluator that looped over every achievement row and executed its predicate
inside a `SECURITY DEFINER` function would therefore run **user-authored SQL
with the definer's privileges** — a straightforward privilege escalation, open
to anyone who can sign up.

**The evaluator reads only rows where `user_id is null`.** System content is
code the server runs; user rows are content the user can see. The two are never
the same thing.

Enforced three ways, because a comment is not a control:

1. The `where user_id is null` clause in the evaluator.
2. A `tests/db/` case that inserts a user-authored achievement whose predicate
   would be observable if executed, and asserts it never runs.
3. The predicate is executed against a **single-row subquery scoped to the
   evaluating user**, so even a system predicate cannot read across users.

## Consequences

**Custom user achievements are not a feature.** The `achievements_write` policy
still permits the row, and nothing evaluates it. That is a latent
half-feature — a user could insert a row that never unlocks. Phase 5 should
either revoke that policy or give user achievements their own non-SQL predicate
form. Written down here rather than discovered later.

**The RPC is the only completion path**, so anything that should award XP has to
go through it. A future feature that awards XP from somewhere else will find the
table unwritable and will have to add a function, which is the intended friction.

**Two definitions of the ceiling exist.** They are pinned together by a test.
This is a deliberate, bounded duplication and not a licence for more.

**`search_path` is pinned on every new function**, following
`20260824150441_function_search_path.sql`. A `SECURITY DEFINER` function with a
mutable `search_path` is the classic Postgres escalation, and there is no reason
to relearn it.

## Alternatives rejected

**Award XP from the Next.js server action using the service role key.**
CLAUDE.md #10 forbids the service role in application code, and it would make
every future bug in a server action a potential ledger corruption.

**Enforce the ceiling only in TypeScript.** It is the criterion most likely to
be quietly broken by a later change, and it is one line of SQL to make
impossible.

**Drop `predicate` as SQL and use a closed enum of predicate kinds.** Genuinely
safer, and it discards invariant #7 — content in rows, not code — which is what
lets an achievement ship as a migration with no application change. Scoping the
evaluator to system rows keeps both properties.

**Revoke `achievements_write` now.** Correct eventually, but it is a phase 0
policy with no caller today; changing it belongs in the phase that decides what
user-authored achievements are, not in a phase that merely stops executing them.
