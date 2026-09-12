# ADR 0032 — A user who starts from nothing, and a reset that only touches them

**Status:** accepted, rework
**Date:** 2026-09-12

## Context

Every seeded account is furnished: twelve weeks of history, five pieces of
equipment, four biometrics, an accepted plan. The app has been built, reviewed
and demoed against users who already have everything.

**So every empty state in this project has been written and never seen.** ADR
0029's "no equipment" card, ADR 0024's three missing-biometric refusals, 8b's
questionnaire, every "nothing here yet" — all argued, all tested, none met by a
person.

A sixth account fixes that, and it is the one the demo actually needs: a real
person's first sixty seconds.

## Decision

### 1. Starting from nothing means no `users` row at all

`currentUser` reads the profile with `maybeSingle()` and falls back to a default
for every field — a decision made long before this ADR and load-bearing here.
**So the fresh account is an auth user and nothing else.** No profile row, no
equipment, no history, no plan, no XP.

That is truer than a row full of nulls, and it exercises a path nothing else
does: the app rendering for somebody the `users` table has never heard of.

**It also surfaces a latent bug rather than working around it.**
`updateSettings` writes with `.update().eq('user_id', …)`, and an UPDATE matching
no rows is not an error — it is a silent success. For every seeded user that is
fine, because the seeder INSERTs their row. For a user who signed up it would
mean their settings appear to save and do not. Onboarding therefore **upserts**,
and `updateSettings` is changed to do the same, because the next real sign-up
would have found it the hard way.

### 2. The onboarding is a route, and every step writes as it goes

`/welcome`, one question per screen. What it asks, and each is a thing the app
cannot infer:

1. **Name** — what the coach calls you.
2. **Age, weight, height, sex** — the four the diet engine needs, with the bounds
   `src/diet/biometrics.ts` already enforces.
3. **Diet goal** — cut, maintain or gain.
4. **Equipment** — ADR 0029's picker, reused rather than rebuilt.
5. **Plan** — 8b's questionnaire and 8b's action, unchanged.

**Each step writes its own table before the next one renders**, which is what
makes it resumable: a closed tab loses nothing, and the route works out where you
are from what is stored rather than from a cursor it has to keep. There is no
onboarding state table, deliberately — that would be a second source of truth
about a thing the real tables already know.

**Every step is skippable except the name**, and skipping is explained rather
than blocked: no biometrics means no calorie target, no equipment means no plan.
Those refusals are already written and already honest. This is the first time
somebody will see them on purpose.

**Nothing is generated until the last step.** A plan costs money and most of a
minute; it must be a press rather than the side effect of finishing a form.

### 3. The diet goal becomes a column, because it had nowhere to live

The Coach tab has a goal selector whose value survives exactly one request. Ask
for a target, close the tab, come back: maintain. Onboarding cannot ask a
question whose answer it has nowhere to put, so `users.diet_goal` is added —
nullable, CHECK-constrained to the same three values `DIET_GOALS` holds.

Nullable rather than defaulted to `maintain`: **"has not said" and "said
maintain" are different**, and the diet block should be able to tell a user which
one it is working from. The code's fallback is unchanged — `normaliseGoal` still
lands on maintain — so nothing that reads it changes behaviour.

### 4. The reset is on the main page, for one account, and deletes only its own rows

The owner asked for it on the main page, for demo convenience. The plan that led
here moved it to Profile and flagged the departure for an overrule; **the
owner's version is the one that ships**, and the reasoning holds up: the control
exists to be pressed between demo runs, and a control you have to navigate to
mid-demo is friction in exactly the moment it was added to remove.

What makes that safe is not where it lives:

- **It renders for one account.** The check is the session's own email against a
  constant, server-side, on both the render and the action. Nobody else sees it
  and nobody else can call it.
- **It deletes only rows the caller owns, through their own session, under
  RLS** — CLAUDE.md #10, no service role. A demo convenience that could reach
  another user's data would be the worst bug in this project, and the policy is
  what stops it rather than the email check.
- **It is confirmed, and it says what it removes**, by name, before it does
  anything.
- **It does not delete the account.** The auth user survives; what goes is
  everything the app wrote. The next sign-in lands on `/welcome` again, which is
  the whole point.

**The email check is a convenience gate, not a security control**, and the
difference matters: if it were bypassed, the caller would delete their OWN rows.
That is the property to hold on to — the blast radius is the caller, always, and
RLS is what guarantees it.

## What this does not guarantee

- **That a real sign-up works.** Hosted sign-up may or may not be open; this ADR
  does not change that. What it guarantees is that an account with no profile row
  can use the app, which is the same shape.
- **That the empty states are good.** It guarantees they will be SEEN. Several
  were written by somebody who had never met them, and the browser pass on this
  account is where that gets found out.
- **That the reset restores a pristine account.** It removes what the app wrote
  for this user. Shared catalogue rows, personas and evidence are untouched
  because they are nobody's, and `llm_calls` is deliberately kept — see below.

## Consequences

- **`llm_calls` survives a reset**, deliberately. The weekly budget is computed
  from it (ADR 0026), so deleting those rows would turn the reset into a way to
  refill the project's spend limit on demand. The demo account resets its
  training; it does not reset its bill.
- One migration, one column, and the `src/db/types.ts` regeneration it forces.
- A sixth seeded account, which the sign-in page lists like the other five.
