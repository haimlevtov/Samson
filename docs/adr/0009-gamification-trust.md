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

`src/gamification/xp.ts` computes and clamps the award. A
`before insert or update` trigger on `xp_events` **independently** refuses any
row that would push `sum(amount)` for `(user_id, week_start)` past
`WEEKLY_XP_CEILING`.

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

**Amended 2026-09-02, after review.** As first shipped this was a `before
insert` trigger reading `sum(amount)` with no lock. Both gaps made the criterion
false rather than merely under-enforced, and both are the same mistake — reading
the guarantee as being about the intended path:

- UPDATE is granted to `authenticated` and `service_role` on every public table
  (`20260824150321_grants.sql`), so raising `xp_events.amount` never met the
  trigger at all. The threat model two paragraphs above is "a bug, a migration,
  a future RPC, or a careless admin script" — none of which only inserts.
- Two concurrent writers each read the same total, each found room under the
  cap, and each took it. A _sequence_ of sessions stayed inside the ceiling; a
  _pair_ arriving together did not.

`20260902095000` fires the trigger on UPDATE as well, excludes the row being
updated from its own total, and takes a `pg_advisory_xact_lock` keyed on
`(user_id, week_start)`. `20260902095200` takes that same lock inside
`award_session_xp` before it reads, so a losing concurrent call clamps to what
is left rather than raising into `finishWorkout`, which swallows the error and
would have dropped the award silently.

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

   _Amended 2026-09-11: false twice, for the same reason both times._ There is
   no scoped subquery. The evaluator binds the user id as `$1`, and each
   predicate's own `where s.user_id = $1` scopes the sets it starts from. A
   predicate that joins onward — to `workouts` (fixed in `20260908140000`), to
   `exercises` (fixed in `20260911100000`, the `five-patterns` predicate) —
   reads the joined table with RLS off, because `evaluate_achievements` is
   `security definer`. Scoping the first table is not scoping the join. Both
   are filtered now, ADR 0003's 2026-09-11 amendment makes the write policies
   refuse the cross-user row in the first place, and `20260911110000` corrects
   the same claim where the database stored it: in a comment inside the
   evaluator's own source.

### 4. Challenge payout is settled by a batch job, not by a request

Added 2026-09-02. Challenges were generated, validated, assigned and rendered,
and nothing ever completed one or paid its `reward_xp`.

Paying out means writing `xp_events`, which only a `SECURITY DEFINER` function
may do. That function has to decide whether the challenge is finished, and there
are only two ways for it to know:

- **Re-derive completion in SQL.** This is a second implementation of
  `evaluateChallenge` — four challenge kinds over a rolling window, plus the
  plausibility filter. `docs/specs/xp-and-challenges.md` warns against exactly
  this: "a separate quest evaluator would be a second definition of what
  completion means, and the two would drift." The weekly ceiling is duplicated
  in SQL and that is tolerable, because it is one integer pinned by a test. So
  is the streak, at one query. A whole evaluator is not the same bet.
- **Trust the caller.** The RPC is granted to `authenticated`, so any signed-in
  client could call it for one of their own challenges and be paid without doing
  the work. That is not moving the trust boundary; it is removing it, and it
  fails the phase criterion "no completion can be granted from the client"
  directly.

**Neither. Settlement runs in `scripts/generate-challenges.ts`, the batch job
that already exists** — server-side TypeScript calling `evaluateChallenge`, the
same function the progress surface calls, so there is one definition. It runs
with the service role, which CLAUDE.md #10 permits in a batch job and forbids in
application code, and it exposes no endpoint for a client to call.

The idempotency guard is the status transition itself: the `UPDATE` filters on
the unresolved statuses, so two overlapping runs cannot both pay — whichever
commits second matches no row. Checking first and updating after would leave
precisely that gap open.

**Amended 2026-09-07.** That filter is now `status = 'active'` alone. Accepting
a challenge became a real transition rather than a label, and only an accepted
challenge settles — see the lifecycle table in `docs/specs/xp-and-challenges.md`.
The idempotency argument is unchanged; what changed is that the same filter is
now the acceptance gate as well as the guard.

**What this costs:** payout is not immediate. A challenge finished mid-session
is paid on the next batch run rather than the moment the set is logged, so the
completion banner cannot fire the way the achievement badge does. That is a real
downgrade in feel and it is the price of not having a payout endpoint. If
immediacy is wanted later, the honest way to buy it is the SQL re-derivation
above, with a test pinning it against `evaluateChallenge` case by case — not a
trusted RPC.

## Consequences

**Custom user achievements are not a feature.** The `achievements_write` policy
still permits the row, and nothing evaluates it. That is a latent
half-feature — a user could insert a row that never unlocks. Phase 5 should
either revoke that policy or give user achievements their own non-SQL predicate
form. Written down here rather than discovered later.

> **Answered 2026-09-08: neither, deliberately, and here is the reason.** Phase
> 5's achievement PR left the policy exactly as it is. Revoking it would remove
> the thing §3's whole security argument is written against — the reason
> `evaluate_achievements` filters `user_id is null` is that a user CAN own a
> row, and a test asserts that such a row is never executed. Delete the ability
> and the test becomes vacuous, the clause looks redundant, and the next person
> reading it removes it too.
>
> Giving user achievements a non-SQL predicate form is a real feature with a
> real design, and nothing in phase 5's brief asks for it.
>
> So the half-feature stays, now stated as a decision rather than an omission: a
> user-owned achievement row is inert by design, it is what the privilege-escalation
> defence is tested against, and `unlocked_achievements()`
> ([ADR 0017](0017-held-hidden-achievements.md)) cannot surface one either —
> there is no way to write the `achievement_events` row it would need.

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
