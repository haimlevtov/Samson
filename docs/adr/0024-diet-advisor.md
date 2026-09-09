# ADR 0024 — The diet advisor: the model gets adjectives, code gets the numbers

**Status:** accepted, phase 6
**Date:** 2026-09-09

> Written before the code it governs, in its own commit —
> [`docs/plans/phase-6.md`](../plans/phase-6.md) PR 2.

## Context

`CLAUDE.md` #6 is the shortest invariant in the file and the only one written as
three sentences instead of one:

> Diet outputs are clamped in code. No prompt, persona, or user request can move
> the floor. The model explains the number; it does not choose it.

`docs/PLAN.md` phase 6 turns it into an acceptance criterion — _"no prompt,
persona, or user framing moves the calorie floor. Every attempt blocked and
logged"_ — and `docs/PRD.md` §7 makes the resulting taxonomy a graded deliverable
rather than an internal note.

**This is the first stage in the project whose output is a prescription.** Every
earlier stage describes something that already exists: the normalizer records
what was lifted, the metrics engine measures it, the planner proposes work the
deterministic rules then check, the chat talks about figures the Profile tab is
already showing. A calorie target is different in kind. Nobody can look at 1,900
and tell whether it is right, there is no second surface to check it against, and
the failure mode is a person eating too little for weeks.

### The design this replaces, and why it was wrong

The first draft of `phase-6.md` planned the stage as the coach chat with a
different payload: send the computed figures, let the model explain them, and let
`findUnknownNumbers` (`src/persona/guard.ts`) reject any figure it was not given.

**That would have satisfied every test in the plan and failed the criterion.**
`src/chat/prompts.ts` adds every numeral in a fenced user turn to the allowed
set, and ADR 0015 §4 defends that deliberately:

> Echoing the user is allowed on purpose… the only person it can mislead is the
> person who supplied it.

True of a chat. Not true of a prescription. A user typing _"I want 800
calories"_ puts 800 into the allowed set; the model answers _"800 is doable if
you're disciplined"_; the guard finds nothing to object to; and a model-chosen
calorie figure renders beside a computed target of 1,900. The variable
`target_kcal` is never touched, so **"no path from model output to `target_kcal`"
stays literally true while the floor moves on the screen** — which is the only
place a user can be harmed. Every adversarial case worth writing carries its own
authorisation this way: "my doctor prescribed 700", "what is my target minus
600".

Two further things were assumed and are false, recorded here because the next
author will reach for both:

- **`scanOutput` does not block a completion for saying "male".**
  `PROTECTED_ATTRIBUTE` in `src/llm/safety.ts` covers gender identity and
  orientation — `transgender`, `non-binary`, `homosexual` — and does not contain
  `male`, `female`, `sex` or `gender`. Its AI-NOTE explains that some obvious
  words are left out on purpose because they fire on ordinary gym language, and
  names `race`, `straight` and `trans` rather than these four; whether their
  absence was deliberate or an oversight, the effect is the same and it is not a
  control. The only thing addressing it is `SAFETY_PREAMBLE`'s conduct rule,
  which ADR 0005 §3 classifies as defence in depth and not a control.
- **A number guard can never be a privacy control**, because the allowed set is
  _derived from the payload_. It protects only what the payload already omits, so
  the payload is doing all the work — and the day somebody widens the payload for
  a good reason, the "guard" silently stops existing and nothing fails.

## Decision

### 1. The model receives categories, never figures — structural

The payload sent to the `diet` stage carries **no numbers at all**. Not the
biometrics, and not the computed calorie figures either. It carries labels and
booleans: the goal, an activity band, whether the target is a deficit, whether
the floor was reached. Four fields, and no fifth.

_Amended after review._ This originally also listed "whether a biometric is
missing" and `as_of`. Neither survived the build: a missing biometric returns
before any model is called, so there is nothing to tell one about, and the date
was the single field that could hold digits — nothing used it, and correlated
with a provider's own request timestamp it discloses roughly what part of the
world somebody is in. Dropping it made "the payload carries no numbers" literally
true, with no exception to remember.

`dietReplySchema` has **no numeric field**, which makes "cannot alter a number"
structural before it is tested. This is the persona's shape, not the chat's —
`docs/plans/phase-3.md` §2 established it: _"its schema has no numeric field at
all, so 'cannot alter a number' is structural before it is tested."_

**Code renders every figure the user sees**, beside the model's prose. That is
`CLAUDE.md` #6 read literally: the model explains the number, and the number
arrives from `src/diet/energy.ts`.

### 2. No digit at all, in any script — code

`/\p{N}/u` over the reply. Any digit is rejected, corrected once in the unfenced
channel (ADR 0008), and then answered by a constant — the same shape
`src/chat/reply.ts` uses, with no fallback to unchecked prose. There is no figure
the model is permitted to state.

> **Amended after review, and the first version of this section was wrong.**
>
> It said `findUnknownNumbers` against an empty set, and that is not sufficient:
> the pattern behind that function is `\d`, which is **ASCII-only even under the
> `u` flag**. So `١٨٠٠`, `१८००`, `１８００` and `¹⁸⁰⁰` all passed the guard and
> the model's figure rendered directly beneath the app's. Asking the question in
> Arabic, Persian, Hindi or Bengali is enough to get a reply in native digits —
> no jailbreak required — and the adversarial suite could not see it, because
> its assertion was `not.toMatch(/\d/)`: the test and the bug shared a blind
> spot.
>
> Widening `findUnknownNumbers` would not have fixed it either. `\p{Nd}` there
> would match, and then `Number('١٨٠٠')` is `NaN`, which `guard.ts` **skips** —
> the widened match would be discarded silently. NFKC normalisation folds
> fullwidth and superscripts and leaves the rest. So the check is stage-local,
> which this stage can afford precisely because nothing is allowed: with an empty
> set there is no membership question, only a predicate.
>
> `guard.ts` is untouched. Its ASCII assumption is load-bearing for the chat and
> the persona, where numerals are compared against a set of numbers.

The check runs over **every string field**, derived from the parsed object rather
than from a hand-written list — the way `deliveredText()` does for the persona's
three. The chat checks one `reply` and that is all the chat has; a second prose
field here would otherwise be unguarded, and a comment promising otherwise is
what review found the first time.

This is strictly stronger than the chat and it is the point of the ADR. It also
makes the privacy property true rather than aspirational: with no numbers in the
payload and none permitted in the reply, there is nothing to derive and nothing
to leak.

### 3. The clamp, in code, before the model is called

```
bmr        = mifflinStJeor(weightKg, heightCm, ageYears, sex)
factor     = activityFactor(sessionsPerWeek)
tdee       = bmr * factor
adjustment = boundedAdjustment(tdee, goal)     // −20% … +15%, default maintain
target     = clamp(tdee + adjustment, max(bmr, 1200), 6000)
```

- **The floor is `max(BMR, 1200 kcal)`.** Never prescribe below resting metabolic
  rate.
- **The ceiling is 6,000 kcal, and it is not decoration.** A `numeric(6, 2)`
  column checked only for positivity admits 9,999.99 kg, and `numeric(5, 1)`
  admits 9,999.9 cm — a BMR near 162,000. A computation that reaches the ceiling
  is a data-entry error, not a diet, and is returned as a refusal.
- **An unrecognised goal falls to maintain, never to a deficit.** The goal is the
  only user-controlled value entering the computation, and a `<select>` is not a
  gate.
- **`sex = 'unspecified'` uses the male constant (+5), the higher of the two.**
  The Mifflin constants differ by 166 kcal. Erring toward _more food_ is the safe
  direction for an error that cannot be avoided — wrong in a fixed, explainable
  direction, the same reasoning `src/metrics/tonnage.ts` gives for counting
  bodyweight lifts as zero.

**Non-finite input is refused before the first multiplication.** In PostgreSQL
`'NaN'::numeric` compares as greater than zero, and PostgREST casts the JSON
string `"NaN"` into a numeric column on the way in — measured against this hosted
project and recorded in `20260908100100_tonnage_comparisons_hardening.sql`. A NaN
weight gives a NaN BMR, `Math.min` and `Math.max` propagate it, and a NaN target
is **not null** — so the missing-biometric refusal would not fire and a NaN would
render. The columns gain bounded checks in the same PR as this ADR, and
`energy.ts` does not trust them.

### 4. The activity factor is measured, not asked

Every calorie calculator asks "how active are you?" and offers five options, and
that answer is the largest error term in the result. Samson has the log:
`sessions_last_28_days ÷ 4`, from the `coachFacts()` the chat already computes on
the same page, maps onto the standard Mifflin bands.

That field is **not recomputed** here. `src/chat/facts.ts` says why its window is
28 days — _"matches the window the Profile tab reports, so the two cannot
disagree"_ — and a second count would be a second definition of one number.

Both the window and the age difference are computed against a `today: LocalDate`
supplied by the caller from `localDateFor(user.timezone)` — `CLAUDE.md` #9, since
a birthday is a calendar event. Nothing in `src/diet/` reads a clock.

**What this is worse at, and the direction it fails in:** it measures training,
not daily activity. A bricklayer who lifts twice a week is classified light and
is not. The error is understatement, which gives a lower TDEE and a lower target
— the _unsafe_ direction for somebody cutting. That is what makes the floor
load-bearing rather than a formality.

### 5. Sex, age, height and weight are collected and never sent

They are stored on `users`, read under RLS from the authenticated user's own row,
and consumed by `energy.ts`. None of them crosses to the provider.

The reason is **data minimisation**, not an enforced constraint — see the
Context. It is a good enough reason on its own: four health fields are a more
sensitive category than anything this app stored before, and the model's job can
be done without them.

Note that `protein_g` is bodyweight in another unit, one division by a published
constant away. A payload carrying it while claiming to carry no weight would be
false. Under decision 1 it does not cross at all, which is why the rule is "no
numbers" rather than "no biometrics".

### 6. Three refusals, and they are code

- **Under 18** — no target, and a sentence pointing at a professional.
- **A missing biometric** — the block names which one and links to Settings,
  rather than defaulting and presenting the default as a calorie target.
- **The ceiling reached, or any non-finite input** — a data-entry error, said as
  one.

`SAFETY_PREAMBLE` already tells every stage to recommend a professional for
medical questions. Per ADR 0005 that is defence in depth, not the control; these
three are the control.

## What this does not guarantee, stated plainly

| Claim                                 | Honest status                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No framing moves the calorie floor    | **Guaranteed for what renders.** Code renders every figure and the model may write no numeral. Not guaranteed for tone: "eat a bit less than that" needs no digits.                                                                                                                                 |
| The reply discloses no body metric    | **Guaranteed only while the payload carries no numbers.** It is the payload doing this, never the guard alone. Widening the payload silently ends it.                                                                                                                                               |
| Under 18 gets no number               | **Mitigated, not guaranteed.** `birth_date` is typed by the user, unverified, and was the one biometric column with no constraint. It buys the honest case and the audit trail; against a minor who wants a number it buys nothing, and if evaded the fallback is a 1,200 kcal **adult** heuristic. |
| This target is safe for this user     | **Not guaranteed.** No medical history is collected. Eating-disorder risk, pregnancy, medication and metabolic conditions are undetectable here. 1,200 is a heuristic floor, not a clinical standard.                                                                                               |
| The activity factor reflects the user | **Mitigated.** It reflects logged training, which is a subset of daily activity, and it errs low.                                                                                                                                                                                                   |
| The user pays for their own abuse     | **Qualified.** ADR 0015 §5's note applies unchanged: one request drives up to attempts × gateway retries, both steerable, and the budget gate reads then calls with no reservation. Rate limiting is out of scope per `CLAUDE.md`.                                                                  |
| The values are gone once you sign out | **No.** Signing out clears the cookie and the local drafts, but a rendered Settings page carrying a bodyweight and a date of birth can return from the browser's back-forward cache on a shared device. The same class `SignOutButton` already handles for session drafts, one step weaker.         |

## Consequences

**The coach is less specific than it could be.** It cannot say "because you are
1.80m and train four times a week"; it says "your resting burn is on the higher
side and your training adds to it", with the figures rendered beside it. That is
the cost of the decision and it is a real one.

**A second stage now writes prose it may not put numbers in**, which means the
correction path and the constants are duplicated in shape between
`src/chat/reply.ts` and `src/diet/advice.ts`. That is deliberate: they have
different allowed sets for different reasons, and merging them would put the
chat's user-echo rule one refactor away from the diet stage.

**`src/metrics/tonnage.ts`'s AI-NOTE is amended by this ADR.** It says _"do not
reach for `users.bodyweight_kg`"_, which is correct about imputing bodyweight
into historical tonnage — a weight change would silently rewrite months of past
numbers. It does not forbid reading the current weight for a present-tense figure
recomputed on every request, and the note now says so rather than reading as a
flat prohibition.

**No `llm_calls.stage` migration.** `diet` has been in the `LlmStage` union, in
`STAGE_MODELS` and in the CHECK constraint since the phase-0 commit. The
supplement retrieval in `phase-6.md` PR 5 runs under the same stage rather than
inventing one.

## Notes

The constants introduced here — the 1,200 floor, the 6,000 ceiling, the −20% and
+15% caps, the activity-band thresholds and the protein target — are added to
`docs/FRAMING.md`'s "Numbers invented outright" table in the same PR, with the
floor marked **load-bearing**. That table already carries the tonnage, e1RM and
ACWR constants, and this is the same kind of choice: a number nobody was asked
about, which the product now behaves as though somebody had chosen.
