# ADR 0017 — A hidden badge is shown to the person who earned it

**Status:** accepted, phase 5 — amended 2026-09-12 (the badge catalogue)
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

PR 7 of `docs/plans/coach-memory-voice-onboarding.md` adds a catalogue: every
badge, what unlocks it, and whether you hold it. (Not the "rework PR 7" of
`rework-hub-history-coach.md`, which was templates — both plans number from one.)
It changes nothing above, and needs two things this ADR did not provide: a
count, and an unlock condition written for somebody who does not hold the badge.

**What the catalogue shows, by case:**

| Badge                | Shown                                                                      |
| -------------------- | -------------------------------------------------------------------------- |
| Visible, held        | Name, description, tier, source hint and date — marked as earned           |
| Visible, not held    | Name, tier and `how_to_earn` — below — if within the user's humour setting |
| Hidden, held         | The same as visible and held — `unlocked_achievements()`, as decided above |
| Hidden, **not** held | **Nothing but that it exists** — a count, and no row                       |

_This table first said the description was the unlock for a visible badge, and
"everything" for a held one. The first was reversed two sections down, and the
second was never true: nobody is sent `how_to_earn` for a badge they hold, or
`predicate` for any badge._

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
3. **Fails closed, deliberately and explicitly.** A null `auth.uid()` would
   join no events, so the naive count would return EVERY hidden badge to a
   signed-out caller — failing open. The function returns 0 when there is no
   caller, and `revoke … from public, anon` keeps it out of their reach besides.
   _A first draft of this amendment headed that point "fails closed" over text
   describing it failing open; the function is what makes the heading true._
4. **No forgery.** It reads `achievement_events` and `achievements` and writes
   nothing.

**What it does disclose, stated plainly:** that hidden badges exist, and how many.
That is information, and a small amount. It is the owner's call, taken with that
named. _This sentence used to add that "the Profile badge count already implies
the same order of magnitude". It does not: that tile counts the badges you hold,
and says nothing about how many hidden ones are left._

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
  careless `select('*')` would hand every visible badge's SQL to the page. What a
  person reads as the unlock condition is `how_to_earn` — below; the predicate is
  a description of the schema. `tests/unit/invariants.test.ts` holds the app to
  this.

  **What that does not stop, stated rather than implied — found in review.** The
  table grant is table-wide, so a signed-in user who calls the API directly can
  read `predicate` for a VISIBLE row. Accepted: a visible badge's definition is
  not a secret this ADR keeps — the name, the tier and now `how_to_earn` are shown
  to everyone — and the SQL adds only the plausibility limits, which are the
  published constants in `src/gamification/plausibility.ts`. A hidden row's
  predicate stays withheld with the row. If a predicate ever carries something
  that is a secret, the fix is a column grant excluding it, and
  `tests/db/schema-invariants.test.ts`'s "DML on every table" check will need to
  learn about column privileges first.

- **It respects the user's humour ceiling for badges they have NOT earned.** The
  catalogue is the first surface to show UNEARNED names. Four shipped badges are
  `cheeky`, so somebody who chose `clean` does not see them listed — _this said
  "changes nothing yet" until review counted_ — and what is held back is
  **counted, not dropped**, for the reason the hidden count exists: "3 more badges
  are above your humour setting." The setting is read by the catalogue itself,
  failing to `clean`, because `currentUser` substitutes the `cheeky` default
  when its read fails. An earned badge is shown regardless: Profile already shows
  it, and hiding something a person holds would be the failure this ADR was
  written to end.

### "How to earn it" is a column, because the description is not one

The plan for this PR said the `description` is what the user reads as the unlock
condition, and that a row whose description did not stand on its own for an
unearned badge was a content bug to be named. **Read against the eleven shipped
rows, every one of them is.** A description is written for the moment of
earning — "You trained on the first of January. Most of the gym was there too;
you came back on the second." That is a reward, in the past tense, addressed to
somebody who has it. Shown to somebody who does not, it is a sentence about a
thing they did not do.

Some are also not the condition. `hundred-tonnes` says "a hundred thousand
kilograms moved"; its predicate also requires thirty separate logged days, which
is the part that makes it a badge about habit rather than one heavy month
(`docs/specs/xp-and-challenges.md`). `new-years-day` says "you trained", and a
planned rest day on the first of January earns it too.

**Rewriting the descriptions was rejected**: it would take the reward copy away
from everybody who already holds a badge in order to serve the people who do
not. So there are two texts, for two moments:

| Column        | Read by                 | Tense                             |
| ------------- | ----------------------- | --------------------------------- |
| `description` | the person who holds it | what you did                      |
| `how_to_earn` | the person who does not | what to do, true to the predicate |

`how_to_earn` is **content, and lives in the row** (CLAUDE.md #7) — never prose
the component invents. It is **required on every shared row** by a CHECK, so the
next achievement migration that forgets it fails when it is applied rather than
rendering a blank card. A user-owned row may omit it: its predicate is never
executed (ADR 0009 §3), so it can never be earned and the catalogue does not
list it.

**It is as secret as the rest of the definition.** A hidden badge's `how_to_earn`
is withheld by the same policy that withholds its name — it is a column on a row
the client never receives. `unlocked_achievements()` does not return it, so a
held hidden badge shows its description, which is what Profile already shows.

### Where the catalogue lives

**`/badges`, a route Profile owns** — the arrangement `/settings` and
`/progression-trees` already have, and not a sixth tab (ADR 0012's budget). The
Badges section on Profile links to it, and so does every badge card there, since
a badge is the thing a person taps expecting to learn about it. It lists **shared
rows only**: the badges the evaluator can actually award.

## Related

- `.claude/skills/add-achievement/SKILL.md` — §4's rule that a hidden
  achievement ships with a test proving the definition is absent from the client
  payload. That test now has a companion proving it is present for the holder.
- [ADR 0009](0009-gamification-trust.md) §3 — why nothing about achievements is
  ever granted from the client.
- [ADR 0003](0003-grants-and-rls.md) — RLS and grants as two independent gates,
  which is why the revoke exists even though the `WHERE` clause already suffices.
