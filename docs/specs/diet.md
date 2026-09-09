# Diet advisor — the contract

The behaviour `src/diet/` is tested against. Design and threat model:
[ADR 0024](../adr/0024-diet-advisor.md). Read that first; this is the part with
the numbers in it.

## 1. What is collected, and where

Four fields on `users`, all of which existed as columns from the phase-0 schema
and none of which anything read or wrote before phase 6.

| Column          | Type            | Constraint after this PR               | Asked for as |
| --------------- | --------------- | -------------------------------------- | ------------ |
| `bodyweight_kg` | `numeric(6, 2)` | `> 0 and < 1000`                       | kilograms    |
| `height_cm`     | `numeric(5, 1)` | `> 0 and < 300`                        | centimetres  |
| `birth_date`    | `date`          | `>= '1900-01-01' and <= current_date`  | a date       |
| `sex`           | `text`          | `in ('male', 'female', 'unspecified')` | three radios |

**The bounds are not cosmetic.** `'NaN'::numeric > 0` is TRUE in PostgreSQL —
measured against this hosted project and recorded in
`20260908100100_tonnage_comparisons_hardening.sql` — and PostgREST casts the JSON
string `"NaN"` into a numeric column on the way in. An upper bound excludes NaN,
because `NaN < 1000` is false, and bounds the magnitude at the same time. Without
one, `bodyweight_kg` admits 9,999.99 and `height_cm` admits 9,999.9, which is a
BMR near 162,000 kcal.

The bounds chosen are human rather than type-shaped: the heaviest person ever
recorded was 635 kg and the tallest 272 cm. That is a deliberate difference from
the tonnage hardening, which took `< 1e10` because _"numeric(12,2) tops out just
under 1e10 anyway"_ — there the column held masses of buildings and any bound was
arbitrary; here the column holds a person.

`birth_date` had **no constraint at all**. It now cannot be in the future, which
closes the case where a date typed as `3000-01-01` produces a negative age that
trips the under-18 refusal by accident rather than by design.

### Units

**Kilograms and centimetres only.** `users.unit_preference` exists, is loaded by
`currentUser`, and is read by no renderer in the application; `app/settings/page.tsx`
says so on the page itself. Accepting imperial input here would scope in the whole
display-conversion layer with no acceptance criterion attached. `CLAUDE.md` #8
asks for canonical storage, which this is.

### Blank means absent

Every one of the four may be cleared. A blank field parses to `null`, is written
as `null`, and the diet block then names it as missing rather than defaulting.

**Missing and zero are distinct states**, and the coercion makes that easy to get
wrong: `z.coerce.number()` maps `""` and `" "` to `0` and `"0x10"` to `16`. The
schema therefore trims and tests for empty **before** coercing, and `0` is a
validation failure rather than a silent absence.

## 2. The equation

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

## 3. The refusals

The engine returns a discriminated result, never a partial number. Each of these
is a distinct case the surface renders in its own words:

| Case                | When                                                       |
| ------------------- | ---------------------------------------------------------- |
| `missing-biometric` | any of the four is null — the result **names which**       |
| `under-18`          | `ageYears < 18` against the user's local date              |
| `implausible-input` | any input non-finite, or the computed target reaches 6,000 |

`under-18` and `implausible-input` are checked before any figure is produced. A
non-finite input is refused **before the first multiplication**: `Math.min` and
`Math.max` propagate NaN, and a NaN target is not null, so it would pass the
missing-biometric branch and render.

## 4. What the model is given, and what comes back

The payload has **no numbers in it**:

| Field           | Type                                                          |
| --------------- | ------------------------------------------------------------- |
| `as_of`         | the user's local date — `CLAUDE.md` #9                        |
| `goal`          | `cut` \| `maintain` \| `gain`                                 |
| `activity_band` | `sedentary` \| `light` \| `moderate` \| `high` \| `very high` |
| `is_deficit`    | boolean                                                       |
| `floor_reached` | boolean — the clamp bound the target rather than the goal     |
| `question`      | present only when the user typed one; fenced                  |

`dietReplySchema` has **no numeric field**. `findUnknownNumbers` runs against an
**empty** allowed set over every string field concatenated, so any numeral in the
reply is rejected, corrected once in the unfenced channel (ADR 0008), and then
answered by a constant. There is no fallback to unchecked prose.

Code renders every figure the user sees: the target, the floor, the protein
figure, the band. The model's prose sits beside them.

## 5. What the tests must cover

**Property sweeps over generated inputs**, not a handful of examples, because the
acceptance criterion is adversarial:

- No combination of weight, height, age, sex, session count and goal produces a
  target below `max(bmr, 1200)`.
- None produces a target above 6,000 — including the magnitudes the columns
  admit before this PR's bounds, and after them.
- `NaN`, `Infinity` and `-Infinity` in each numeric input return
  `implausible-input`, never a number.
- The adjustment is bounded in both directions regardless of goal, and an
  unrecognised goal never produces a deficit.
- Monotonic where it must be: heavier is never fewer calories, more sessions is
  never fewer calories.
- `unspecified` never yields less than `female` would.
- `under-18` is evaluated against a supplied `today`, so the boundary is testable
  on both sides of a birthday.

**Database, in `tests/db`:**

- Each of the four columns rejects `NaN`, a negative, zero, and a magnitude past
  its bound.
- `birth_date` rejects a future date.

**Settings, in the unit suite:**

- The settings schema and the parse object carry the same keys. The class of bug,
  not the instance — a field in one and not the other made every save fail once
  already, and typecheck cannot see it because the parse object is an untyped
  literal.
- A blank optional field round-trips to `null`, and `0` is rejected rather than
  stored.
