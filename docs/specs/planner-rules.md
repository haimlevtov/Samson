# Specification — `src/planner/rules.ts`

The deterministic floor under the phase 2 planner. Pure functions over a plan
and its context, returning findings. No I/O, no clock, no model.

This document is the contract. It is written to be sufficient on its own: the
tests for this module are authored from **this file alone**, without reading the
implementation, because a test derived from the code agrees with the code
whether or not either is right.

---

## Why this module exists

A training block can be perfectly well-formed and still dangerous. Schema
validation is a shape check — a block prescribing twenty sets of squats parses
exactly as cleanly as a sensible one. A model asked to respect a volume cap will
usually respect it, and the failures are fluent: confident, well-structured, and
over the cap.

So every limit expressible as arithmetic is enforced by arithmetic. The critic
model judges what is left over.

---

## The contract

```ts
export type RuleCode =
  | 'weekly_volume_increase'
  | 'acwr_band'
  | 'deload_cadence'
  | 'equipment_available'
  | 'load_ceiling'
  | 'injured_joint';

export interface RuleFinding {
  code: RuleCode;
  detail: string; // human-readable, non-empty
  weekNumber: number | null;
}

export function checkRules(block: TrainingBlock, context: RuleContext): RuleFinding[];
```

`checkRules` runs **every** rule and returns all findings, in the `RuleCode`
order listed above. It never short-circuits on the first failure: one round trip
that reports three problems is worth three round trips that report one each.

An empty array means the block passed. Each individual rule is also exported
under its own name with the same `(block, context) => RuleFinding[]` signature.

### `RuleContext`

```ts
export interface CandidateEquipment {
  slug: string;
  maxLoadKg: number | null; // null = no ceiling on this item
}

export interface RuleCandidate {
  slug: string;
  name: string;
  primaryMuscle: string; // e.g. 'quadriceps', 'shoulders'
  movementPattern: string | null; // 'push'|'pull'|'squat'|'hinge'|'carry'|'core'|'isolation'
  equipment: CandidateEquipment[];
}

export interface RuleContext {
  candidates: RuleCandidate[];
  injuredJoints: string[];
  /** The user's actual recent weekly tonnage, kg. 0 when there is no history. */
  baselineWeeklyTonnageKg: number;
  /** Mean weekly tonnage over the chronic window, kg. Null when history is too short. */
  chronicWeeklyTonnageKg: number | null;
}
```

### Constants (exported)

| Name                          | Value  |
| ----------------------------- | ------ |
| `MAX_WEEKLY_TONNAGE_INCREASE` | `0.10` |
| `DELOAD_REQUIRED_BY_WEEK`     | `5`    |

`acwr_band` uses `ACWR_HIGH_RISK` (`1.5`) imported from `src/metrics/acwr.ts`.

### Prescribed tonnage

Several rules need the tonnage a week prescribes. It is defined the same way as
logged tonnage in `src/metrics/tonnage.ts` — **external load only**:

> For every set in every session of the week: `weight_kg × reps`, summing to the
> week total. A set whose `weight_kg` is `null` contributes **zero**, not an
> imputed bodyweight.

---

## The rules

### 1. `weekly_volume_increase`

Prescribed tonnage must not rise more than `MAX_WEEKLY_TONNAGE_INCREASE` (10%)
above the week it is measured against.

**The comparison baseline for a given week is the most recent preceding
non-deload week.** For the first non-deload week in the block, it is
`context.baselineWeeklyTonnageKg`.

_Why not simply the previous week:_ returning to normal volume after a deload
would otherwise register as a large spike every single time, and the rule would
fire on correct programming.

- Deload weeks are never themselves flagged. A deload is meant to drop.
- When the applicable baseline is `0`, emit no finding. There is no meaningful
  ratio against zero, and a first-ever block has no history to exceed.
- A decrease is never a finding. This rule has one direction.
- Emit at most one finding per offending week, with that week's `weekNumber`.

**Boundaries.** Baseline 1000 kg: a week of 1100 kg passes (exactly 10%); 1100.1
kg fails. Comparison is against the ratio, not a rounded percentage.

### 2. `acwr_band`

Guards the jump from what the user is conditioned to, into week 1.

- When `context.chronicWeeklyTonnageKg` is `null` or `0`, emit no finding —
  this mirrors `acwr()` returning `null` rather than guessing on thin history.
- Otherwise compute `week1PrescribedTonnage / chronicWeeklyTonnageKg`.
- Emit one finding when that ratio is **at or above** `ACWR_HIGH_RISK` (1.5),
  with `weekNumber: 1`.

**Boundary.** Chronic 1000 kg: 1499.9 kg passes, 1500 kg fails. The threshold is
inclusive, because `acwrBand` in the metrics engine already treats `>= 1.5` as
`danger` and the two must not disagree.

### 3. `deload_cadence`

- A block with fewer than `DELOAD_REQUIRED_BY_WEEK` (5) weeks needs no deload —
  emit no finding.
- A block of 5 or more weeks must contain at least one week with
  `is_deload === true` among weeks 1 to 5 **inclusive**.
- A deload that appears only at week 6 or later does not satisfy this.
- At most one finding, `weekNumber: null` — this is a property of the block, not
  of any single week.

Weeks are identified by their `week_number` field, not by array position.

### 4. `equipment_available`

Every `exercise_slug` appearing anywhere in the block must match the `slug` of
some entry in `context.candidates`.

- One finding per **distinct** unknown slug, however many times it appears.
- `weekNumber` is the first week the slug appears in.
- Matching is exact and case-sensitive. A slug differing only in case is unknown.

_Why this can fire at all:_ the candidate list is filtered in SQL before the
model sees it, so a slug outside the list is the model inventing an exercise —
which is exactly what invariant #5 exists to catch.

### 5. `load_ceiling`

No prescribed weight may exceed the ceiling of the equipment it needs.

Determining the ceiling for one exercise:

1. Look the exercise up in `context.candidates` by slug. **If it is absent, this
   rule emits nothing for it** — rule 4 already owns that failure, and reporting
   it twice conflates two different problems.
2. Collect the non-null `maxLoadKg` values across that candidate's `equipment`.
3. If there are none, the exercise is unlimited — emit nothing.
4. Otherwise the ceiling is the **minimum** of them.

_Why the minimum:_ if any implement the movement needs is capped, that cap
binds. Yossi's dumbbells stop at 30 kg regardless of what else is in the room.

- A set with `weight_kg === null` is never a finding.
- Emit one finding per distinct (exercise, week) pair that breaches, naming the
  prescribed weight and the ceiling in `detail`.

**Boundary.** Ceiling 30 kg: 30 kg passes, 30.01 kg fails. Exceeding means
strictly greater.

### 6. `injured_joint`

No exercise may load a joint listed in `context.injuredJoints`.

An exercise loads a joint when **either** its `primaryMuscle` is in that joint's
muscle set **or** its `movementPattern` is in that joint's pattern set:

| Joint        | Muscles                                  | Patterns     |
| ------------ | ---------------------------------------- | ------------ |
| `knee`       | quadriceps, hamstrings, calves           | squat        |
| `hip`        | glutes, hamstrings, adductors, abductors | hinge, squat |
| `lower-back` | lower back                               | hinge, carry |
| `shoulder`   | shoulders, chest, lats, traps            | —            |
| `elbow`      | biceps, triceps, forearms                | —            |
| `wrist`      | forearms                                 | carry        |
| `ankle`      | calves                                   | squat        |

- A joint string outside this table is **ignored**, emitting nothing. It is not
  an error and not a finding.
- An exercise absent from `context.candidates` emits nothing here — rule 4 owns
  that, as in rule 5.
- An empty `injuredJoints` emits nothing.
- One finding per distinct (exercise, week) pair, naming the exercise and the
  joint in `detail`.

---

## What the tests must establish

For each of the six rules:

1. **A plan violating it produces a finding with that exact `code`** — this is
   the phase 2 acceptance criterion, stated per rule.
2. **A plan satisfying it produces no finding from that rule.**
3. **The stated boundary value passes and the value just past it fails**, for
   the four rules that name one.
4. **The documented exemptions hold** — zero baseline, short block, null weight,
   unknown joint, absent candidate.

And for `checkRules` as a whole:

5. A clean plan returns `[]`.
6. A plan breaching three different rules returns findings for all three, not
   just the first.
7. Findings come back in `RuleCode` declaration order.

Fixtures should be built by small helpers rather than by hand — a block builder
taking weeks of prescribed tonnage will make most cases one line.

---

## Out of scope for this module

Anything requiring judgement rather than arithmetic: whether the exercise
selection suits the goal, whether a plateaued lifter is being given the same
thing that already stopped working, whether the split is balanced. Those are the
critic's, and `src/planner/schema.ts` holds its closed vocabulary of reasons.

**AI-NOTE:** if a proposed rule can be written as a comparison against a number,
it belongs here, where no model gets a vote. That boundary is ADR 0004.
