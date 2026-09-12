# ADR 0017 — A hidden badge is shown to the person who earned it

**Status:** accepted, phase 5
**Date:** 2026-09-08

> **Written after the migration, at a reviewer's prompting, and that is worth
> saying rather than hiding.** The decision itself was recorded before the code,
> in `docs/plans/phase-5-content-fill.md` PR 2, which merged first — so the
> ordering rule in `CLAUDE.md` was not broken. What was missing is that this is
> a decision **with a rejected alternative**, which the project's doc coupling
> says belongs in an ADR rather than in a plan or a migration header. It is the
> second object in the schema that returns rows a policy withholds; the first
> got [ADR 0016](0016-leaderboard.md).

## Context

The phase-0 schema wrote a policy and left its consequence unanswered:

```sql
create policy achievements_read_visible on public.achievements
  for select to authenticated
  using ((user_id is null or user_id = auth.uid()) and hidden = false);
```

`docs/PLAN.md` phase 5 requires that "hidden achievement definitions are never
sent to the client", and that policy is the enforcement — deliberately in the
policy rather than in a query, so no future endpoint can leak them by forgetting
a filter.

It answers the question about a **locked** hidden achievement. It says nothing
about a **held** one, and the two are different questions that the same clause
was answering identically.

The observable behaviour until now: `src/db/gamification.ts` joined
`achievement_events` to `achievements` through the user's own session, so a
hidden badge the user had unlocked joined to nothing and came back null. The
reader dropped it. An AI-NOTE in that file said as much and deferred the
decision to this phase.

So unlocking a hidden achievement did this: the `achievement_events` row was
written, 75 XP was paid, and **the user was shown nothing at all**. There was no
badge, no name, no description, and no indication that anything had happened.
The tier that exists to reward finding something nobody told you about was the
one tier that could not tell you that you had found it.

Until this phase there were no hidden rows, so nothing had ever exercised it.

## Decision

**A held hidden badge is revealed in full to its holder, and to nobody else.**
`public.unlocked_achievements()` — a `security definer` function taking **no
parameter**, scoped to `auth.uid()`, returning the definitions of achievements
the caller already holds an `achievement_events` row for.

The reader in `src/db/gamification.ts` calls it instead of joining.
`achievements_read_visible` is untouched.

## Why this does not weaken the invariant

The criterion is about **definitions of achievements the user has not earned**.
Four properties, each resting on something other than this function's good
behaviour:

1. **No enumeration.** The function returns rows joined _from_
   `achievement_events`, so an achievement with no unlock event for this caller
   cannot appear. There is no "which would fire" oracle either —
   `evaluate_achievements` was revoked from `authenticated` in migration
   20260902094000 for precisely that reason.
2. **No subject selection.** There is no `p_user_id`. A caller does not get to
   say who they are, so there is no parameter to poison and no PostgREST filter
   that reaches the `WHERE` clause.
3. **Fails closed when signed out.** `achievement_events.user_id` is `not null`,
   so a null `auth.uid()` makes the comparison `NULL` rather than `true` and the
   function returns the empty set. The `revoke ... from anon` is defence in
   depth on top of that, not the gate — which is the right way round.
4. **The unlock event cannot be forged.** `achievement_events` has one policy
   and it is `for select`. Every writer is a definer function scoped to
   `auth.uid()`. A user can insert their own `achievements` row and set
   `hidden = true` on it, but cannot create an event pointing at it.

Knowing what you hold is not knowing what exists.

## Alternatives rejected

**Relax the policy to `hidden = false or exists(... my unlock event ...)`.**
This is the obvious one and it is what the first draft would have been. Rejected
because it puts the exception **inside the control**. Every future query against
`achievements` would inherit it, from any endpoint, written by anyone — and the
invariant would then be a property of a policy expression that has to be re-read
carefully each time somebody touches that table. Keeping the policy absolute and
adding one narrow, parameterless read leaves exactly one object to audit, and it
is an object whose entire purpose is this exception.

**Leave it as it was — filtered out.** This is what shipped, by default rather
than by decision. Rejected because it is the worst of both: the definition stays
secret _and_ the reward disappears, so a user is paid in a currency they cannot
see. If a badge is not going to be shown, it should not be awarded.

**Show a placeholder — "you unlocked something, and it is a secret".** Rejected
as the same failure with extra steps. It withholds from the person the secret
was being kept from, which is not who it was being kept from.

**Never mark hidden badges as hidden in the UI.** Rejected because the tier then
buys nothing: a badge whose definition was withheld arrives looking like every
other badge, and the fact that you found something unannounced — the whole
reward — is invisible. Profile marks a held hidden badge with a `found` chip.

## Consequences

- One more `security definer` function to audit. It is listed here and in
  migration `20260908090100` so it is findable from both ends.
- `src/db/gamification.ts` must not be "simplified" back to a PostgREST join.
  It typechecks, it passes every unit test, and it silently loses hidden
  badges — so the file carries an AI-NOTE saying so.
- A held hidden badge's `description` and `source_hint` now reach a client.
  Anything written into those columns for a hidden row is user-visible once
  earned, which is the point, and is worth remembering when authoring one.

## Amendment 2026-09-12 — the catalogue, and how many are left to find

Rework PR 7 adds a catalogue: every badge, what unlocks it, and whether you hold
it. It changes nothing above, and needs one thing this ADR did not provide.

**What the catalogue shows, by case:**

| Badge                | Shown                                                      |
| -------------------- | ---------------------------------------------------------- |
| Visible, held        | Everything, marked as earned                               |
| Visible, not held    | Name, description and tier — the description is the unlock |
| Hidden, held         | Everything — `unlocked_achievements()`, as decided above   |
| Hidden, **not** held | **Nothing but that it exists** — a count, and no row       |

The owner decided on 2026-09-12 to show the count rather than omit those rows
silently: a catalogue that quietly drops rows teaches people the list is
complete when it is not, and "two more to find" is better copy than a short
list.

### The count is not reachable through the policy, and the plan said it would be

`docs/plans/coach-memory-voice-onboarding.md` said the catalogue needs "no new
policy: the existing one already returns exactly the rows the user may see". That
is true of the ROWS and false of the COUNT. `achievements_read_visible`
withholds a locked hidden row entirely, which is its job — so a client counting
what it can see counts zero hidden badges, and cannot tell "none exist" from
"none are visible to you".

So the count needs a function. **`public.hidden_achievements_remaining()`** — a
`security definer` function taking **no parameter**, returning **one integer**:
shared hidden achievements the caller holds no unlock event for.

### Why a number is not a definition

This ADR's criterion is that hidden **definitions** are never sent to somebody
who has not earned them. The function returns none: no name, no slug, no id, no
description, no tier, no predicate. The four properties above still hold, and
the count adds nothing to any of them:

1. **No enumeration.** A single integer cannot be walked. There is no per-row
   result to page through and no id to probe.
2. **No subject selection.** No parameter. The caller counts for themselves.
3. **Fails closed.** A null `auth.uid()` joins no events, so a signed-out caller
   would count every hidden badge — a number, not a definition — and `revoke …
from public, anon` stops it reaching them anyway.
4. **No forgery.** It reads `achievement_events` and `achievements` and writes
   nothing.

**What it does disclose, stated plainly:** that hidden badges exist, and how many.
That is information, and a small amount. It is the owner's call, taken with that
named — and the Profile badge count already implies the same order of magnitude.

### Rejected, again

**Relaxing the policy so a client can count hidden rows.** The same alternative
this ADR rejected, for the same reason: it moves the exception inside the
control, and every future query against `achievements` inherits it. A
single-purpose function that can only ever return a number keeps the exception
outside the policy, where it cannot be widened by accident.

**Hard-coding the count in the component.** Content lives in the database
(CLAUDE.md #7), and a number typed into a component is wrong the day a hidden
achievement is added.

### Two things the catalogue must not do

- **It never selects `predicate`.** That column is the SQL an achievement is
  evaluated with (ADR 0009) and `achievements_read_visible` grants the row, so a
  careless `select('*')` would hand every visible badge's SQL to the browser. The
  `description` is what a person reads as the unlock condition; the predicate is a
  description of the schema.
- **It respects the user's humour ceiling for badges they have NOT earned.** Every
  shipped achievement is `clean` or `cheeky` today, so this changes nothing yet —
  but the catalogue is the first surface to show UNEARNED names, and a future
  `crude` row would otherwise reach a user who chose `clean`. An earned badge is
  shown regardless: Profile already shows it, and hiding something a person holds
  would be the failure this ADR was written to end.

## Related

- `.claude/skills/add-achievement/SKILL.md` — §4's rule that a hidden
  achievement ships with a test proving the definition is absent from the client
  payload. That test now has a companion proving it is present for the holder.
- [ADR 0009](0009-gamification-trust.md) §3 — why nothing about achievements is
  ever granted from the client.
- [ADR 0003](0003-grants-and-rls.md) — RLS and grants as two independent gates,
  which is why the revoke exists even though the `WHERE` clause already suffices.
