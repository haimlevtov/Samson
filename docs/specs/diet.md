# Diet advisor — the contract

The behaviour `src/diet/` is tested against. Design and threat model:
[ADR 0024](../adr/0024-diet-advisor.md). Read that first; this is the part with
the numbers in it.

> **§1 describes code that exists. §2 to §5 do not yet.** The advisor ships over
> four PRs ([`plans/phase-6.md`](../plans/phase-6.md)) and this spec was written
> whole, before them, so the tests can be written from it. As of **2026-09-09**
> only the inputs in §1 are built — `src/diet/biometrics.ts`, the settings
> fields, and the column bounds. `energy.ts`, the clamp, `dietReplySchema` and
> the surface are PRs 3 and 4. Nothing below §1 should be read as a description
> of the running app.

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

## 2. The equation — **PR 3, not built**

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

## 3. The refusals — **PR 3, not built**

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

## 4. What the model is given, and what comes back — **PR 4, not built**

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

**Property sweeps over generated inputs** — PR 3, not written — not a handful of
examples, because the acceptance criterion is adversarial:

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
