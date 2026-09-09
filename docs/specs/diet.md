# Diet advisor — the contract

The behaviour `src/diet/` is tested against. Design and threat model:
[ADR 0024](../adr/0024-diet-advisor.md). Read that first; this is the part with
the numbers in it.

> **Each section says whether it describes code that exists.** The advisor ships
> over four PRs ([`plans/phase-6.md`](../plans/phase-6.md)) and this spec was
> written whole, before them, so the tests can be written from it.
>
> As of **2026-09-09** all of §1–§4 are built: `src/diet/biometrics.ts`,
> `energy.ts`, `schema.ts`, `prompts.ts`, `advice.ts` and the disclosure on
> `/coach`. What remains of the phase is PR 5, retrieval-only supplement
> answers, which this document does not cover.

## 1. What is collected, and where — **built**

Four fields on `users`, all of which existed as columns from the phase-0 schema
and none of which anything read or wrote before phase 6.

| Column          | Type            | Constraint after this PR                | Asked for as                    |
| --------------- | --------------- | --------------------------------------- | ------------------------------- |
| `bodyweight_kg` | `numeric(6, 2)` | `> 0 and < 1000`                        | kilograms                       |
| `height_cm`     | `numeric(5, 1)` | `> 0 and < 300`                         | centimetres                     |
| `birth_date`    | `date`          | `between '1900-01-01' and '2100-01-01'` | a date                          |
| `sex`           | `text`          | `in ('male', 'female', 'unspecified')`  | a select: blank, plus the three |

**The bounds are not cosmetic.** `'NaN'::numeric > 0` is TRUE in PostgreSQL —
measured against this hosted project and recorded in
`20260908100100_tonnage_comparisons_hardening.sql` — and PostgREST casts the JSON
string `"NaN"` into a numeric column on the way in. An upper bound excludes NaN,
because `NaN < 1000` is false, and bounds the magnitude at the same time. Without
one, `bodyweight_kg` admits 9,999.99 and `height_cm` admits 9,999.9 — together a
BMR near 162,000 kcal, and the weight alone at an ordinary height is still over
100,000.

**Scale is part of the bound.** PostgreSQL rounds a numeric to its declared scale
_before_ the CHECK runs, so `299.99` submitted to `height_cm numeric(5, 1)`
becomes `300.0` and then violates `< 300` — a rejection of a value the form
accepted, which no retry can fix, for the whole window 299.95–299.99. The quieter
half: `170.55` would be accepted and silently stored as `170.6`. So the app
grammar admits **one** decimal place for height and **two** for weight, matching
the columns. Two gates are defence in depth only while they agree.

The bounds chosen are human rather than type-shaped: the heaviest person ever
recorded was 635 kg and the tallest 272 cm. That is a deliberate difference from
the tonnage hardening, which took `< 1e10` because _"numeric(12,2) tops out just
under 1e10 anyway"_ — there the column held masses of buildings and any bound was
arbitrary; here the column holds a person.

`birth_date` had **no constraint at all**. It is now bounded to a range a human
birth date can fall in, which closes the case where `3000-01-01` produces a
negative age that trips the under-18 refusal by accident rather than by design.

**"Not in the future" is checked in the action, not the column.** A CHECK holding
`current_date` is accepted by PostgreSQL and is a footgun: it evaluates in the
server's timezone, which `CLAUDE.md` #9 forbids for anything calendar-shaped, and
existing rows are never rechecked. The column holds a bound that cannot rot; the
action compares against the user's own local date. Same split `users.timezone`
already documents.

### Units

**Kilograms and centimetres only.** `users.unit_preference` exists, is loaded by
`currentUser`, and is read by no renderer in the application; `app/settings/page.tsx`
says so on the page itself. Accepting imperial input here would scope in the whole
display-conversion layer with no acceptance criterion attached. `CLAUDE.md` #8
asks for canonical storage, which this is.

### Blank means absent

Every one of the four may be cleared. A blank field parses to `null`, is written
as `null`, and the diet block then names it as missing rather than defaulting.

**Missing and zero are distinct states**, and the obvious tool destroys the
distinction: `z.coerce.number()` maps `""` and `" "` to `0`, and `"0x10"` to
`16`. A cleared field would become a person who weighs nothing, and the
missing-biometric refusal — the only thing that tells a user which field the
advisor is waiting for — would be unreachable.

So `measurementField` trims, treats empty as `null` **before** any conversion,
and then requires a plain decimal at the column's own scale rather than whatever
`Number()` will accept. `0` is a validation failure naming the field, not a
silent absence and not a database error naming a constraint. `\d` in a
non-unicode regex is `[0-9]` only, so fullwidth and Eastern Arabic digits are
rejected here even though `Number()` reads them.

**An omitted field is not a cleared one.** Blank means "remove this"; a
submission that does not carry the key at all is **rejected**. They were the same
thing once, and the difference was destructive: a POST carrying only the
appearance fields succeeded and erased all four health values, with "Saved" on
screen. Every other field already failed loudly when absent.

`birth_date` gets a real-date check, and the round trip is what does it.
`Date.parse('2026-02-31T00:00:00Z')` does **not** return `NaN` — V8 rolls it over
to **3 March**. (An out-of-range _month_ like `2026-13-01` does give `NaN`, so a
`Date.parse` check catches half of this; the half it misses is the quiet one.) A
birth date silently moved three days is the kind of wrong nothing downstream
detects, and it feeds the age comparison that decides whether a target is shown
at all. `isRealDate` builds the date from its parts and requires the parts to
survive.

## 2. The equation — **built**

Mifflin–St Jeor, in kilograms, centimetres and years:

```
bmr = 10 * weightKg + 6.25 * heightCm - 5 * ageYears + constant
```

| `sex`         | constant |
| ------------- | -------- |
| `male`        | +5       |
| `female`      | −161     |
| `unspecified` | **+5**   |

`unspecified` takes the male constant — the higher of the two, 166 kcal apart —
because erring toward more food is the safe direction for an error that cannot be
avoided. ADR 0024 §3.

### Age

`ageYears` is whole years from `birth_date` to `today`, where `today` is the
user's local date from `localDateFor(user.timezone)` — `CLAUDE.md` #9, because a
birthday is a calendar event. It is supplied by the caller; nothing in
`src/diet/` reads a clock.

### The activity factor

From `sessions_last_28_days ÷ 4`, taken from `coachFacts()` (`src/chat/facts.ts`)
rather than recomputed. Bands are the standard Mifflin multipliers:

| Sessions per week | Factor | Band      |
| ----------------- | ------ | --------- |
| `< 0.5`           | 1.2    | sedentary |
| `0.5 – 2.99`      | 1.375  | light     |
| `3 – 4.99`        | 1.55   | moderate  |
| `5 – 6.99`        | 1.725  | high      |
| `>= 7`            | 1.9    | very high |

`tdee = bmr * factor`.

### The adjustment and the clamp, in this order

```
adjustment = boundedAdjustment(tdee, goal)
target     = clamp(tdee + adjustment, max(bmr, 1200), 6000)
```

**The upper bound is a refusal before it is a clamp.** A target that would reach
6,000 returns `implausible-input` (§3) rather than a target of 6,000, so the
`min` in that expression is unreachable by construction — it stays because an
invariant asserted in one place and enforced in another is an invariant with a
gap in it. **No surface ever has to render a 6,000 kcal target.**

| Goal       | Adjustment   |
| ---------- | ------------ |
| `cut`      | −20% of TDEE |
| `maintain` | 0            |
| `gain`     | +15% of TDEE |

**An unrecognised goal is `maintain`.** The goal is the only user-controlled
value entering the computation and a `<select>` is not a gate; the action
validates it with `z.enum` and the default branch is the safe direction.

**Protein** is `1.8 g` per kg of bodyweight, rounded to the nearest gram. It is
computed and rendered; it is never sent to a model — it is bodyweight one
division away.

## 3. The refusals — **built**

The engine returns a discriminated result, never a partial number. Each of these
is a distinct case the surface renders in its own words:

| Case                | When                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `missing-biometric` | any of the four is null — the result **names which**                                                                          |
| `under-18`          | `0 <= ageYears < 18` against the user's local date; the result carries the age, and it is always a number a sentence can hold |
| `implausible-input` | one of four reasons, below                                                                                                    |

| `implausible-input` reason | When                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `non-finite`               | a measurement is `NaN` or infinite                                                        |
| `out-of-range`             | a measurement is finite and outside its bound, **or `sex` is outside the three**          |
| `unreal-date`              | a date is the wrong shape or an impossible day, or the age is negative or past 130        |
| `no-resting-rate`          | the equation produced nothing positive, or a figure that would render as zero — see below |
| `ceiling`                  | the target or the floor reaches 6,000 kcal                                                |

A non-finite input is refused **before the first multiplication**: `Math.min` and
`Math.max` propagate NaN, and a NaN target is not null, so it would pass the
missing-biometric branch and render.

**`no-resting-rate` was found by the sweep, on its first run.** Mifflin–St Jeor
goes negative for combinations every column admits — one kilogram at one
centimetre, aged 120, female is 10 + 6.25 − 600 − 161 = **−745 kcal**. The floor
still rescued the target, which came out at a perfectly reasonable 1,200, and
that is exactly why it needed catching: the clamp did its job and the page would
have shown "your resting burn is −745 kcal" beside a sensible-looking number. A
body the equation returns nothing positive for is refused rather than clamped
into looking sane.

## 4. What the model is given, and what comes back — **built**

The payload has **no numbers in it**. `dietFacts()` in `src/diet/energy.ts` is
the allowlist that builds it, and it lives there rather than in the prompt layer
so that widening it is a change to the file where the invariant is written down:

| Field           | Type                                                                               |
| --------------- | ---------------------------------------------------------------------------------- |
| `as_of`         | the user's local date — `CLAUDE.md` #9, and the only field that may contain digits |
| `goal`          | `cut` \| `maintain` \| `gain`                                                      |
| `activity_band` | `sedentary` \| `light` \| `moderate` \| `high` \| `very high`                      |
| `is_deficit`    | boolean                                                                            |
| `floor_reached` | boolean — the clamp bound the target rather than the goal                          |

The optional question is a separate fenced block, not a field. It is **the
stage's only untrusted input**, and it is the reason there is fencing here at
all — everything else in the payload is the app's own.

`dietReplySchema` has **no numeric field**, and returns two short prose fields:
`summary` and `caveat`. `findUnknownNumbers` runs against an **empty** allowed
set over both concatenated, so any numeral is rejected, corrected once in the
unfenced channel (ADR 0008), and then answered by a constant. There is no
fallback to unchecked prose.

**There is no transcript.** The chat fences replayed turns because its history is
client-held and therefore untrusted (ADR 0015 §2); this stage answers one
question about one figure and keeps nothing, so that channel does not exist to
be attacked.

Code renders every figure the user sees: the target, the floor, the resting
burn, the maintenance figure and the protein target. The model's prose sits
beside them, and the figures render even when the call fails — which is the
practical point of computing them first.

### The surface

A `<details>` disclosure on `/coach`, between the plan and the chat.
`docs/specs/mobile-interface.md` draws the line it has to satisfy: _"a disclosure
reveals more of what the page is already about; a different subject gets a route
instead."_ A calorie target for the training being coached on the same page is
the same subject, and it is one block rather than a page.

**Nothing fires on page load.** Every state renders something: nothing asked yet,
each of the three refusals in the app's own words, a target, and a target with
the model's sentence missing because the call failed.

## 5. What the tests must cover

**Property sweeps over generated inputs** — built, `src/diet/energy.test.ts`,
35,280 combinations — not a handful of examples, because the acceptance criterion
is adversarial:

- No combination of weight, height, age, sex, session count and goal produces a
  target below `max(bmr, 1200)`.
- None produces a target above 6,000 — including the magnitudes the columns
  admit before this PR's bounds, and after them.
- `NaN`, `Infinity` and `-Infinity` in each numeric input return
  `implausible-input`, never a number.
- Every figure is a **positive** whole number, not merely a finite one — a
  negative BMR passed the clamp once, and the target it produced looked fine.
- The target is bounded by the goal **or** by the floor, and `floorReached` says
  which. There is no third source. An unrecognised goal never produces a deficit.
- Monotonic where it must be: heavier is never fewer calories, more sessions is
  never fewer calories.
- `unspecified` never yields less than `female` would.
- `under-18` is evaluated against a supplied `today`, so the boundary is testable
  on both sides of a birthday — including a 29 February one, which ages on 1
  March in a non-leap year, a day late rather than a day early.

**Proof the sweep is load-bearing.** Each of these was broken deliberately and
the failures recorded before the PR opened: removing the floor from the clamp
(3 tests red), flipping the `unspecified` constant to `female`'s (1), dropping
the age gate (3), and removing the non-positive BMR refusal (2).

**Database, in `tests/db` — built, `tests/db/biometrics.test.ts`:**

- The two **numeric** columns reject `NaN`, a negative, zero, and a magnitude
  past their bound. (`birth_date` is a `date` and `sex` is `text`; neither can
  hold any of those, and the tests do not pretend otherwise.)
- Each numeric column **stores what it was given**, and rounds at its declared
  scale — one decimal for `height_cm`, two for `bodyweight_kg`. Asserting the
  rounding is what makes the app-side grammar's bound meaningful rather than
  hopeful.
- `birth_date` rejects a date outside 1900–2100, and **accepts** one in the
  future: that is refused by the action against the user's local date, for the
  reason in §1. The test says so, so that removing the action-side check does
  not look safe.
- `sex` admits exactly the three values `SEXES` holds, imported rather than
  retyped.

**Settings, in the unit suite — built, `tests/unit/settings-schema.test.ts`:**

- The settings schema and the parse object carry the same keys, **and so do the
  `name=` attributes the form renders**. The class of bug, not the instance: a
  field in one and not the other made every save fail once already, typecheck
  cannot see it because the parse object is an untyped literal, and a mistyped
  `name=` is worse than that — it makes every save write `null` over a stored
  health value with the suite green.
- A blank optional field round-trips to `null`; `0` is rejected rather than
  stored; and an **omitted** field is rejected rather than treated as cleared.
- A decimal the column would round is rejected rather than stored as a different
  number.
