# Diet advisor — the contract

The behaviour `src/diet/` is tested against. Design and threat model:
[ADR 0024](../adr/0024-diet-advisor.md). Read that first; this is the part with
the numbers in it.

> **Each section says whether it describes code that exists.** The advisor ships
> over four PRs ([`plans/phase-6.md`](../plans/phase-6.md)) and this spec was
> written whole, before them, so the tests can be written from it.
>
> As of **2026-09-09** everything here is built: `src/diet/biometrics.ts`,
> `energy.ts`, `schema.ts`, `prompts.ts`, `advice.ts`, `supplements.ts`, and the
> two disclosures on `/coach`.

## 1. What is collected, and where — **built**

Four fields on `users`, all of which existed as columns from the phase-0 schema
and none of which anything read or wrote before phase 6.

| Column          | Type            | Constraint after this PR                | Asked for as         |
| --------------- | --------------- | --------------------------------------- | -------------------- |
| `bodyweight_kg` | `numeric(6, 2)` | `> 0 and < 1000`                        | kilograms            |
| `height_cm`     | `numeric(5, 1)` | `> 0 and < 300`                         | centimetres          |
| `birth_date`    | `date`          | `between '1900-01-01' and '2100-01-01'` | a date               |
| `sex`           | `text`          | `in ('male', 'female', 'unspecified')`  | a select — see below |

**`sex` is asked for differently on the two surfaces**, and the column is the
same on both.

- **Settings** offers a blank ("Not set") plus the three, because clearing a
  field is a thing a settings form must allow and because a row that already
  holds `unspecified` has to be displayable.
- **`/welcome` offers two**, male and female, behind an empty "Choose one" that
  cannot be submitted. The owner's instruction, and the reason is this table:
  the BMR constant is selected by sex, so a target computed from `unspecified`
  is derived from a value nobody stated. Safe — it takes the higher constant —
  and not an answer. Declining is the Skip button, not a value.

Labels live in `src/ui/sex.ts`; the welcome step used to render the raw column
values, which showed somebody the word "unspecified".

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

> **Amended 2026-09-12, rework PR 8a.** This section described a stage of its
> own. The diet answer is a ROUTE of the coach box now, and four statements
> below are no longer true of the payload: it also carries the training facts,
> the supplement candidates and up to eight fenced transcript turns, because all
> three are prepared before the route is known. What did NOT change is the part
> the guarantees rest on — the target is computed and rendered by code and is
> never in the payload, no biometric crosses at all, and the allowed set on this
> route is still empty. Each false statement is marked in place. The full
> accounting is in [ADR 0024](../adr/0024-diet-advisor.md)'s 2026-09-12
> amendment.

The payload has **no numbers in it**. _(No longer true of the whole payload —
`factsBlock` carries training figures. Still true of the diet block itself, and
no biometric crosses on any route.)_ `dietFacts()` in `src/diet/energy.ts` is
the allowlist that builds it, and it lives there rather than in the prompt layer
so that widening it is a change to the file where the invariant is written down:

| Field           | Type                                                          |
| --------------- | ------------------------------------------------------------- |
| `goal`          | `cut` \| `maintain` \| `gain`                                 |
| `activity_band` | `sedentary` \| `light` \| `moderate` \| `high` \| `very high` |
| `is_deficit`    | boolean                                                       |
| `floor_reached` | boolean — the clamp bound the target rather than the goal     |

The optional question is a separate fenced block, not a field. It is **the
stage's only untrusted input**, and it is the reason there is fencing here at
all — everything else in the payload is the app's own. _(No longer the only one:
since PR 8a the replayed transcript and the supplement claim text are untrusted
inputs on this route too, and both are fenced.)_

**Four fields, and none of them can hold a digit.** `as_of` used to be a fifth
and was removed in review: nothing read it, and a date correlated with a
provider's request timestamp discloses roughly what part of the world somebody
is in. `CLAUDE.md` #9 is satisfied by the engine evaluating against the user's
local date, not by the model being told what it was.

`dietReplySchema` has **no numeric field**, and returns two short prose fields:
`summary` and `caveat`. The check is **`/\p{N}/u` over every string field**,
derived from the parsed object rather than a hand-written list — any digit in
any script is rejected, corrected once in the unfenced channel (ADR 0008), and
then answered by a constant. There is no fallback to unchecked prose.

**Not `findUnknownNumbers`, and that is the point.** Its pattern is `\d`, which
is ASCII-only even under the `u` flag, so `١٨٠٠` and `１８００` passed it — the
hole review found, recorded in ADR 0024 §2 with why the obvious fix does not
work.

**There is no transcript.** _(FALSE since PR 8a, and it is the most consequential
line in this section.)_ It read: the chat fences replayed turns because its
history is client-held and therefore untrusted (ADR 0015 §2), while this stage
answered one question about one figure and kept nothing, so that channel did not
exist to be attacked. A diet answer is now produced inside that transcript, so
the channel exists and ADR 0015 §2 is what guards it — every turn fenced, the
coach’s own included, and no `assistant` role in the payload.

Code renders every figure the user sees: the target, the floor, the resting
burn, the maintenance figure and the protein target. The model's prose sits
beside them, and the figures render even when the call fails — which is the
practical point of computing them first.

### The surface

A `<details>` disclosure on `/coach`, between the plan and the box.
`docs/specs/mobile-interface.md` draws the line it has to satisfy: _"a disclosure
reveals more of what the page is already about; a different subject gets a route
instead."_ A calorie target for the training being coached on the same page is
the same subject, and it is one block rather than a page.

**Nothing fires on page load.** Every state renders something: nothing asked yet,
each of the three refusals in the app's own words, a target, and a target with
the model's sentence missing because the call failed.

**Amended 2026-09-12, rework PR 8a.** The disclosure keeps the goal selector and
the figures, and **loses its own question box** — questions go to the one box
below, which routes a diet question back to this stage's guard. Two things did
not change and are the reason this is an amendment rather than a redesign:

- **The target is still computed before any model is involved**, and it renders
  whether or not one could be reached. It is now computed on every question
  rather than only on a diet one, because a route is not known until the answer
  comes back and `computeEnergy` is pure arithmetic — ADR 0015 §6.
- **The allowed set is still empty**, so a diet answer containing any numeral is
  still rejected, retried, and replaced by `UNEXPLAINED_DIET_REPLY`.

What did change: the answer is **one field rather than `summary` and `caveat`**.
Those were two because the panel rendered a sentence and a muted line under it;
one box returns one answer. §4's guarantee is the empty allowed set, not the
field count.

## 4b. Supplements, answered rather than browsed — **built**

`docs/PRD.md` §5.7 asks for supplement answers as **retrieval-only coach
responses**, which is a different thing from the page at `/evidence`. ADR 0023 is
the contract for what a row means; this is what happens when one is asked for.

**The model's entire output is a slug.** `supplementReplySchema` is
`z.strictObject({ slug: z.enum([NO_MATCH, ...slugs]) })`, built from the rows
actually presented — `strictObject` so nothing rides along beside the slug, and
the enum so the slug itself is an allowlist. So:

- there is **no text field that is read** — it was no text field at all until
  PR 8a, and the merged schema carries a `reply` the other routes need, which
  this route discards unread. Procedural where it was structural; §4c and
  [ADR 0023](../adr/0023-evidence-rows.md)’s 2026-09-12 amendment say so;
- a slug the model invents fails the gateway's own validation and is retried,
  rather than reaching `.eq('slug', modelString)` and returning a silent null —
  `docs/plans/phase-3.md`'s rule for the planner, applied here;
- the row handed back is an object **from the array that built the allowlist**,
  never one refetched by a model-supplied string.

The payload carries slug, name and claim — not the dose, the caution or the
citation, because the model chooses a row rather than describing one. Claims are
fenced and per-field sanitised: they are the project's own rows, but every one
paraphrases a source nobody here read in full.

**The claim cap is 280 characters, not `MAX_FIELD_CHARS`.** That constant is 120
and is sized for an exercise name; ten of the thirteen shipped claims are longer
than it, so every one reached the model truncated mid-sentence. The
`eaa-supplementation` row was cut at _"Whether that beats simply eating …"_,
severing the negation — so the selector read an endorsement. The user still saw
the whole row; the **selection** was made on inverted text.

`NO_MATCH` renders a constant, with the link to `/evidence` beside it as a real
anchor rather than a word in the string. An empty table calls no model at all,
because `z.enum` cannot be built from an empty list and paying for a lookup
against nothing would be worse than the error.

**One row is rendered by the same component `/evidence` uses**
(`src/ui/EvidenceCard.tsx`), including the grade's LABEL. A copy of that markup
dropped it on its first outing, and `app/globals.css` states the invariant on the
`.evidence-grade` rule itself: state is never carried by colour alone.

**It logs under `stage: 'diet'`** and deliberately gains no stage of its own,
which would need an `llm_calls.stage` migration. The cost is real: the per-stage
token breakdown `docs/PLAN.md` grades now mixes two call shapes under one label.
They stay separable by `prompt_prefix_hash`, which differs because the system
prompts differ.

**What this does not stop**, recorded as passing tests: nothing checks that the
row the model picked answers the question asked, and `NO_MATCH` is its own
judgement about coverage. What retrieval buys is narrower than "the answer is
right" — it is that every word read was written against a source, and that a
wrong answer is a wrong **row** rather than an invented claim.

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

## 4c. The supplement answer, after one box — rework PR 8a, 2026-09-12

§4b's contract is unchanged in every part that matters, and the part that moved
is worth stating rather than leaving to be discovered:

- **The allowlist is still the schema.** The one box's schema is built per call
  from the rows `loadEvidence` returned, exactly as `supplementReplySchema` was,
  so an invented slug is still a validation failure the gateway retries rather
  than a lookup that returns null.
- **The model still has no text field on this route.** Its `reply` is not shown
  when the route is `supplement` — the answer is the row.
- **The rows are still read before the call**, RLS-scoped and filtered to shared
  rows. They are read for every question now, not only a supplement one, because
  a route is not known until the answer comes back.

What is gone is `SupplementPanel` as a separate surface and its own field. The
`/evidence` link in the Coach header stays: an answer is one row, and the table
is the thing to read.
