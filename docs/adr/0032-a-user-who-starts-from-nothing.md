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
2. **Coach** — which persona. Added by rework PR 8; see the amendment below.
3. **Age, weight, height, sex** — the four the diet engine needs, with the bounds
   `src/diet/biometrics.ts` already enforces.
4. **Diet goal** — cut, maintain or gain.
5. **Equipment** — ADR 0029's picker, reused rather than rebuilt.
6. **Plan** — 8b's questionnaire and 8b's action, unchanged.

**Each step writes its own table before the next one renders**, which is what
makes it resumable: a closed tab loses nothing, and the route works out where you
are from what is stored rather than from a cursor it has to keep.

**One column, and no more — amended after review.** This section originally said
there was no onboarding state at all, because the real tables already know. That
is right about WHICH STEP to show and wrong about WHETHER THE FLOW HAS EVER BEEN
FINISHED. The first version derived the second from the display name being
absent, and a reviewer showed that is a supported steady state rather than a
signal: `settingsSchema` turns a blank name into null on purpose — _"empty means
no name, not an empty name; the headers fall back to email"_ — so a
long-standing user who cleared their name was bounced into onboarding
permanently. `users.onboarded_at` is that one fact, and it is not derivable from
anything else.

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

- **It renders for one account**, and the check is the session's own email
  against a constant, server-side, on both the render and the action.
- **The work is a `security definer` function that TAKES NO ARGUMENT** — the user
  is `auth.uid()` from the verified JWT, so a caller cannot express the wish to
  delete somebody else's rows. There is nowhere to put the id.
- **That function checks the account too**, which is the correction review forced
  and which changes what the email gate IS — see below.
- **It is confirmed, and it says what it removes**, by name, before it does
  anything.
- **It does not delete the account.** The auth user survives; what goes is
  everything the app wrote. The next sign-in lands on `/welcome` again, which is
  the whole point.

### The first version could not delete four of the nine tables it named

FOUND IN REVIEW, by both reviewers, and it is the same mistake this ADR's own
module diagnosed correctly for `public.users` one paragraph later: **the policies
were read for one table and assumed for the rest.**

`achievement_events`, `xp_events` and `challenges` are `for select` only;
`plan_runs` is select and insert. All four are deliberate — [ADR
0009](0009-gamification-trust.md)'s position is that no completion is granted
from the client. `authenticated` holds the DELETE grant, so a client delete is
not rejected: **RLS filters it to zero rows and PostgREST returns success.** The
app reported a reset while the XP, the badges, the challenges and the accepted
plan all survived — and the card had named them to the user. Worse, because
`plan_runs` survived, `latestAcceptedPlan` kept returning a row, so the re-run
onboarding decided the plan step was answered and never offered it: the last beat
of the demo, silently skipped.

**The fix is not `..._delete_own` policies.** One of them would be a real cheat:
`achievement_events` is once-only, so a user who could delete their own rows
could re-earn every badge and be paid its XP again. ADR 0009 §3's whole position
is that the client does not write gamification outcomes, and a delete is a write.

So the work moved into `reset_demo_account()`, a `security definer` function —
the shape `accept_challenge` and `award_session_xp` already use for "the client
may not write this table, and this specific operation is nonetheless allowed". It
is also **one transaction**, which the loop was not: a failure partway through
that loop left an account half reset under a card telling the user to try again.

### So the email check is a control now, and this ADR said otherwise

The first version of this section said the check was _"a convenience gate, not a
security control"_, on the reasoning that a bypass would only let somebody delete
their own rows. That reasoning held while the deletes ran on the caller's own
client. It does not hold for a `security definer` function, which runs as the
owner — so the account check moved into the function, where it is what stops any
other user reaching a capability the policies deliberately withhold.

**Both properties now hold, and they are different.** The function cannot be
pointed at another user, because it takes no argument. And it cannot be called by
another user at all, because it checks the caller's own address.

### The main page was the wrong main page — amended 2026-09-12, rework PR 8

§4 above says the reset ships on the main page, and it did: `app/hub/page.tsx`,
last on the tab. The owner then asked where the reset button was.

**It was unreachable by the only account that has it.** `HubPage` redirects a
user whose `onboarded_at` is null to `/welcome` — §2's own rule, and correct —
and the demo account's `onboarded_at` is null by design, because that is what
makes it the fixture. So the control that exists to restart the demo could only
be reached by somebody who had already finished the demo.

Neither decision was wrong on its own. The fault is in the pair, and it is the
kind only a user finds: two rules that each hold, composing into a control with
no path to it.

**The fix is placement, not the gate.** The card renders on `/welcome` as well —
for that account `/welcome` IS the main page until the flow is done — and its
refusals redirect back to whichever page it was pressed on, because sending them
to `/hub` would bounce straight back here with the message stripped off the URL.
The Hub copy stays for the case after onboarding. Nothing about the authority
changes: `reset_demo_account()` still takes no argument and still reads
`raw_app_meta_data`.

### And then it moved to the sign-in page — amended 2026-09-12, same day

The owner saw the fix and asked for something simpler: **the reset goes on the
sign-in page, next to that account, as one button with no explanation and no
confirmation.** That supersedes §4's placement and the amendment above it; both
are kept because the reasoning is what a reader needs, not the destination.

It is better than either, and for a reason neither version could reach:

- **No redirect can strand it.** Hub and `/welcome` are both behind a session,
  so where the button lives depends on where the app has decided to send this
  user. `/sign-in` is the one page with no such decision in front of it.
- **The action signs in and resets in one press**, landing on `/welcome` — which
  is the state the button exists to produce. Pressing it IS starting the demo.
- **It needs no gate of its own.** The old card rendered on an email match; this
  button is one row of a list of published fixtures.

**The confirmation goes, and that is the owner's call taken with the cost
named.** A typed RESET stood in front of an irreversible delete. What it guarded
is one seeded demo account whose password is printed on the same page, so
anybody who can press the button can already sign in and empty it by hand. The
button adds no capability that page did not have; it removes the friction the
owner asked twice to be rid of.

**What does not change is the only thing that was ever the control.**
`reset_demo_account()` is `security definer`, takes no argument, and refuses any
caller whose `raw_app_meta_data` is not marked. A signed-in user cannot write
that column. An unauthenticated POST to this action signs in as a published
fixture and resets that fixture's own rows; it reaches nothing else.

**`RESET_TABLES` and `RESET_KEEPS` are deleted with the card.** They existed so
that what the user was SHOWN and what the function DID could be held together —
review found them disagreeing twice. With nothing rendering them they were two
dead arrays and an AI-NOTE describing a screen that no longer exists, which is a
worse guard than none: it reads as maintained.

### Sex is asked for as three options, not two

The owner asked for "male or female only" and the plan entry for this PR wrote
that down as "the welcome control offers the two". It offers three, and the
departure is recorded here rather than left in a source comment.

What was there was worse than either reading: a blank option ON TOP of `SEXES`
rendered raw, so the list read "Prefer not to say / male / female /
unspecified" — four entries, two of which mean the same thing, and only one of
those two counting as an answer. Blank writes null, `hasBiometrics` wants a
value, and the step then re-renders with nothing said.

So the two SEXES are the two on offer, and the third entry is named as a
declining rather than as a sex. The value behind it is `unspecified`, which has
existed since ADR 0024 §3 with a defined behaviour — it takes the higher of the
two Mifflin constants, so it never under-feeds anybody. A health profile with no
way to decline is not something this project will ask for, and it does not have
to: Settings keeps its blank, and `/welcome` cannot, because on that surface
blank leaves the step unanswered.

### A sixth question, and the column three things had been waiting for

Onboarding asks which coach you want, and that needs `users.persona_slug`.

[ADR 0031](0031-talking-during-a-session.md) §5 settles for "the first shared,
voiced coach alphabetically" for the session voice and says in as many words
that persisting the choice _"is a column and a settings control, and it belongs
with whatever change wants it on more than one screen"_. This is that change:
the Coach tab's picker dies with the page, and PR 6 wants the same answer.

**Nullable**, like `diet_goal` and for the same reason — "has not chosen" is not
"chose the first one" — so nothing changes behaviour by the column existing.

**No foreign key**, which the plan for PR 8 said there would be and which the
schema does not allow: `personas` is unique on `(user_id, slug)`, so there is no
unique on `slug` alone to reference, and adding one would forbid a user-owned
persona from sharing a slug with a shared one. It would not buy much either — a
coach is retired with `is_active = false` rather than deleted, so a stored slug
can stop naming anything the picker lists while the constraint is fully
satisfied. Readers fall back regardless. The integrity is the welcome step's own
check of the posted slug against the rows `listPersonas` returned.

**It is cleared by the reset**, with the rest of the onboarding answers, and that
is a rule rather than a detail: every column `src/onboarding/steps.ts` reads to
decide whether a step is answered must be cleared, or the reset silently
shortens the flow it exists to restore. A surviving `plan_runs` row did exactly
that before review caught it.

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
- One migration, two columns and one function, plus the `src/db/types.ts`
  regeneration they force.
- A sixth seeded account, which the sign-in page lists like the other five.
- **`updateSettings` upserts too**, which this ADR claimed in its first version
  and the code did not do — caught by review. Without it the demo account could
  open Settings, save, read "Saved" and lose everything, because it has no
  profile row to update.
- **The Coach tab now reads and writes `diet_goal`.** Adding the column without a
  reader would have left it write-only and made this document's own copy false:
  onboarding tells the user they can change the goal on that tab and it will be
  remembered.
