# Spec — XP, streaks and challenges

Status: authoritative
Date: 2026-09-02 — **amended 2026-09-07: the Level section, and the challenge
lifecycle**
Governs: `src/gamification/`

This document is the contract. As with `planner-rules.md`, the tests for
`src/gamification/` are written from this document, and a disagreement between
this text and the implementation is a bug in one of them — decide which, then
change both.

Every number below is computed by code in `src/gamification/`. No model is
consulted, ever — CLAUDE.md #1.

---

## Why XP is shaped this way

The failure mode a strength-training game has to avoid is **paying people to
overtrain**. Volume-scaled XP does exactly that: the way to earn more is to lift
more, and the app becomes a machine for producing injuries in exactly the
population least able to judge when to stop.

So XP derives from **adherence** — did you do what the plan asked — and never
from tonnage (CLAUDE.md #4). The `xp_events.source` check constraint already
omits a `volume` value, and that omission is deliberate.

Three consequences follow, and all three are testable:

1. **A rest day earns the same as a training day**, when both were planned.
   `adherence()` already treats `rest` as kept.
2. **Diminishing returns within a week.** The seventh session of a week earns
   materially less than the first, so there is no reward for cramming.
3. **A weekly ceiling.** Past it, additional work earns nothing at all.

---

## The contract

```ts
export const SESSION_BASE_XP = 100;
export const DIMINISH_FACTOR = 0.8;
export const WEEKLY_XP_CEILING = 500;
export const ACHIEVEMENT_XP = 75;
export const STREAK_MILESTONES = [7, 14, 30, 60, 100] as const;
export const STREAK_MILESTONE_XP = 50;

export type XpSource = 'adherence' | 'streak' | 'achievement' | 'challenge' | 'quest';

export interface XpAward {
  source: XpSource;
  amount: number; // always >= 0
  reason: string; // human-readable, non-empty
}

/** XP for the nth kept session of a week, 1-indexed. */
export function sessionXp(nth: number): number;

/** Every award a week's workouts earn, before the ceiling is applied. */
export function weeklyAwards(workouts: readonly WorkoutRecord[], week: WeekWindow): XpAward[];

/** Milestone awards crossed by moving from `previous` to `current` streak length. */
export function streakAwards(previous: number, current: number): XpAward[];

/** Clamps a proposed award to what the week has left. Never returns negative. */
export function applyCeiling(alreadyAwarded: number, proposed: number): number;
```

### `sessionXp`

`sessionXp(n) = round(SESSION_BASE_XP × DIMINISH_FACTOR^(n−1))`, for `n ≥ 1`.
`sessionXp(n) = 0` for `n < 1`.

| nth session | 1   | 2   | 3   | 4   | 5   | 6   | 7   |
| ----------- | --- | --- | --- | --- | --- | --- | --- |
| XP          | 100 | 80  | 64  | 51  | 41  | 33  | 26  |

Seven kept sessions therefore earn **395**, comfortably inside the 500 ceiling.
The ceiling binds only when achievements, streaks or challenges also pay out in
the same week — which is the intent: the ceiling is a cap on a good week, not a
punishment for a normal one.

### `applyCeiling`

`applyCeiling(already, proposed) = max(0, min(proposed, WEEKLY_XP_CEILING − already))`.

An `already` above the ceiling returns 0 rather than a negative number. That
case should be unreachable, and the function is defined for it anyway because
"unreachable" is a claim about callers, not about this function.

### Streak milestones

`streakAwards(previous, current)` returns one award per milestone in
`STREAK_MILESTONES` that is `> previous` and `<= current`. Moving from 6 to 8
crosses 7 and yields one award; moving from 8 to 6 yields none; moving from 0 to
30 crosses 7, 14 and 30 and yields three.

**Why it takes both numbers rather than just the current streak:** an award has
to fire once, on the day the milestone is crossed. Given only `current`, day 8
of a streak looks identical to day 7 and would pay twice.

---

## Properties

These are the acceptance criterion, stated so they can be generated against.
For any sequence of workouts and any week:

| Property              | Statement                                                                  |
| --------------------- | -------------------------------------------------------------------------- |
| **Non-negative**      | every `XpAward.amount >= 0`                                                |
| **Monotonic**         | adding a kept session to a week never decreases that week's total          |
| **Diminishing**       | `sessionXp(n + 1) <= sessionXp(n)` for all `n >= 1`                        |
| **Ceiling holds**     | no sequence of workouts, statuses or dates produces a weekly total `> 500` |
| **Rest is neutral**   | a `rest` day and a `completed` day earn identically at the same position   |
| **Unresolved is nil** | `planned` and `in_progress` days earn nothing until they resolve           |

---

## Level

A level is a reading of lifetime XP. It is **derived, never stored** — there is
no level column, no level-up event and no timestamp, so the same history always
yields the same level and there is nothing to migrate when the curve is tuned.

```ts
export const LEVEL_BASE_XP = 300;
export const LEVEL_GROWTH = 1.25;

export interface LevelProgress {
  level: number; // 1 or above
  intoLevel: number; // XP earned since this level began, >= 0
  span: number; // XP this level costs end to end, > 0
  toNext: number; // XP still needed for the next level, > 0
}

/** The level a lifetime XP total earns. Level 1 starts at zero. */
export function levelForXp(lifetimeXp: number): number;

/** Total XP required to have REACHED `level`. `xpForLevel(1) === 0`. */
export function xpForLevel(level: number): number;

/** Everything the UI needs, so it cannot derive a bar that disagrees. */
export function levelProgress(lifetimeXp: number): LevelProgress;
```

### The curve

Level 1 begins at 0 XP. Climbing **from** level `n` **to** `n + 1` costs
`round(LEVEL_BASE_XP × LEVEL_GROWTH^(n−1))`, so:

| Level | Cost to reach it | Reached at |
| ----- | ---------------- | ---------- |
| 1     | —                | 0          |
| 2     | 300              | 300        |
| 3     | 375              | 675        |
| 4     | 469              | 1,144      |
| 5     | 586              | 1,730      |
| 10    | 1,788            | 7,741      |

Each step is rounded **before** it is summed, so `xpForLevel` is a sum of
rounded steps rather than the rounding of a sum. The two drift apart by a few XP
by level 10, and only the first satisfies the boundary property below.

**WHY geometric and not linear:** a linear curve makes level 30 exactly as far
from 29 as 2 is from 1, so the number stops meaning anything once the early
levels are gone. **WHY 1.25 and not 2:** the weekly ceiling is 500, so a
doubling curve would put level 10 beyond a year of perfect adherence, and a
level nobody reaches is not a reward. At 1.25 a consistent user is around level
10 after a season, which is the horizon this app is built for — one demo, one
training block, not a decade.

**The first level-up is reachable inside a strong first week, deliberately.** A
perfect week earns 395 and level 2 costs 300, so a new user who trains all week
levels up. That is onboarding, not a leak: the reward has to arrive while
somebody is still deciding whether to come back.

**The anti-farming guarantee is the weekly ceiling, not the cost of level 2.**
Because a week cannot yield more than `WEEKLY_XP_CEILING`, levelling is bounded
by adherence however the curve is tuned — measured: **no single week can produce
more than two level-ups, from any starting XP**. That is asserted as a property
rather than argued, and it is the claim that would actually break if someone
raised the ceiling.

### Properties

| Property           | Statement                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------- |
| **Floor**          | `levelForXp(x) >= 1` for every `x >= 0`, including 0                                         |
| **Monotonic**      | `x <= y` implies `levelForXp(x) <= levelForXp(y)`                                            |
| **Never negative** | `intoLevel >= 0` and `toNext > 0` for every input                                            |
| **Agreement**      | `intoLevel + toNext === span`, and `levelForXp(x + toNext) === level + 1`                    |
| **Boundary**       | `levelForXp(xpForLevel(n)) === n`, and `levelForXp(xpForLevel(n) − 1) === n − 1` for `n > 1` |

The **agreement** property is the one that matters for the interface. A progress
bar computed from one rule beside a "420 XP to level 6" label computed from
another is the classic way this feature ships subtly wrong, so `levelProgress`
returns every figure the UI prints and the UI derives none of them itself.

**Negative or non-finite input** is treated as 0 rather than throwing. Lifetime
XP is a sum over a ledger whose amounts are non-negative by constraint, so a
negative total is unreachable — and a progress bar is not the place to discover
that it happened.

---

## Plausibility

The brief requires "plausibility checks on submitted loads". A set that is not
plausible does not count toward a challenge or an achievement. It is **not**
deleted, and the user is not accused of anything — it is logged as their data
and excluded from rewards.

```ts
export type ImplausibleCode = 'exceeds_established_best' | 'impossible_volume' | 'nonsense_value';

export interface PlausibilityFinding {
  code: ImplausibleCode;
  detail: string;
  setIndex: number;
}

export function checkPlausibility(
  sets: readonly SetRecord[],
  history: readonly SetRecord[]
): PlausibilityFinding[];
```

- **`exceeds_established_best`** — the set's e1RM (via `src/metrics/e1rm.ts`)
  is more than `PLAUSIBLE_E1RM_MULTIPLE` (1.5) times the user's best recorded
  e1RM for that exercise. With no history for the exercise, nothing is
  implausible: a first entry has nothing to contradict.

  **Above `EPLEY_MAX_REPS` (12) the comparison is on raw load instead.** Epley
  returns null past its cap, so the e1RM test cannot run — and a check that
  goes quiet above 12 reps is blind in exactly the range where a "400 instead
  of 40" typo hides. The same 1.5 multiple is applied to the heaviest weight
  the user has ever moved for that exercise (`bestWeightKg`), which needs no
  formula and is if anything more generous at high reps than at low.

- **`impossible_volume`** — more than 100 reps in a single set.
- **`nonsense_value`** — a negative weight or reps, or a weight above 500 kg.

**Warmups are not implausible, and still earn nothing.** `checkPlausibility`
returns no finding for a warmup — it is honest data and the user did nothing
wrong — but `plausibleSets`, which is what every reward path reads, drops them.
The two exclusions are separate on purpose: one is distrust, the other is simply
that a warmup is not the work being rewarded. Without the second, three
empty-bar sets on three movements complete a distinct-exercises challenge.

**Why it is relative to the user's own history and not an absolute table:** an
absolute ceiling either insults a strong lifter or waves through a beginner
typing 200 instead of 20. The user's own record is the only reference that
scales correctly, which is why `exceeds_established_best` is silent until there
is one.

---

## Challenges and quests

One validator serves both. A daily quest is a challenge with `window_days: 1`;
there is no second code path — the brief asks for reuse and this is it.

### The `spec` shape

`challenges.spec` is jsonb, validated by a Zod schema:

```ts
{
  kind: 'sessions' | 'distinct_exercises' | 'sets_at_rpe' | 'streak_days',
  target: number,       // 1..50
  window_days: number,  // 1..14
  reward_xp: number,    // 10..150
  rpe_at_least?: number // only for kind 'sets_at_rpe'
}
```

### Two different validations, deliberately not one function

| Function              | Question                                       | Runs when           |
| --------------------- | ---------------------------------------------- | ------------------- |
| `validateCandidate()` | is this challenge worth offering at all?       | pool generation     |
| `evaluateChallenge()` | has the user completed this offered challenge? | server-side, on log |

Conflating them was tempting and is wrong: a challenge can be perfectly
well-formed and not yet complete, which is the normal case, and that must not be
recorded as a rejection.

### Rejection vocabulary — `validateCandidate`

A rejected candidate is written to `challenges` with `status: 'rejected'` and
its reasons in `validation_reasons`. It is **not discarded**, because the phase
criterion is that a rejected challenge is inspectable, and a dropped row is not.

| Code                    | Meaning                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `target_unreachable`    | the target cannot fit what bounds it — see below                          |
| `below_current_ability` | the user already does this without changing anything; not a challenge     |
| `reward_out_of_band`    | `reward_xp` outside 10..150                                               |
| `window_mismatch`       | a `daily` challenge whose `window_days` is not 1                          |
| `missing_threshold`     | a `sets_at_rpe` challenge with no `rpe_at_least` to measure against       |
| `unknown_exercise`      | the user has no candidate exercises at all, so nothing could be performed |

Each finding carries a `detail` naming the offending number, for the same reason
`RuleConstraint` exists in the planner (ADR 0008): a human reads the detail, and
anything acting on it reads the fields.

**What bounds `target_unreachable`** differs by kind, and only two kinds have a
bound at all:

| Kind                 | Bound                                                    |
| -------------------- | -------------------------------------------------------- |
| `sessions`           | `window_days` — progress is counted per day              |
| `streak_days`        | `window_days`                                            |
| `distinct_exercises` | the size of the user's equipment-filtered candidate list |
| `sets_at_rpe`        | none; a day holds any number of sets                     |

The `distinct_exercises` bound is the one that matters in practice: without it a
bodyweight-only user with two available movements is offered "five distinct
movements this week" and nothing rejects it. The target is not hard, it is
impossible.

**`reward_out_of_band` is the band, not the ceiling.** `MAX_REWARD_XP` is 150
and the weekly ceiling is 500, so any reward inside the band is payable and a
ceiling comparison can never fire. Checking only the ceiling made the code
unreachable through the schema and let a stale row carrying 300 validate clean.

**`unknown_exercise` is narrower than its name.** `ChallengeSpec` carries no
exercise field, so a spec cannot reference a slug at all and the original
meaning — "references a slug outside the user's candidate list" — is not
expressible. It currently means "the candidate list is empty". Either the spec
shape grows an exercise field or this code should be retired; recorded here
rather than left as a name that promises more than it does.

### Completion — `evaluateChallenge`

Returns `{ met: boolean; progress: number; target: number }`.

**Completion is derived from logged rows only.** Nothing the client sends is
input. This is the phase's "no completion can be granted from the client"
criterion, and `docs/adr/0009-gamification-trust.md` records how it is enforced
rather than merely intended.

Sets failing `checkPlausibility` are excluded from `progress` before it is
compared with `target`, and so are warmups — `progress` counts only what
`plausibleSets` returns.

**`sessions` counts distinct days, not workout rows.** `workouts` has no unique
constraint on `(user_id, local_date)` and `startWorkout` inserts a row per call,
so counting rows let three workouts in one afternoon complete "three sessions
this week". Counting days is also what makes the `window_days` bound above true
rather than merely assumed.

### The lifecycle, and what accepting is for

A challenge moves through these states, and nothing else moves it:

| From      | To          | Moved by                                                  |
| --------- | ----------- | --------------------------------------------------------- |
| —         | `offered`   | the weekly batch, for a candidate that passed validation  |
| —         | `rejected`  | the weekly batch, for one that did not                    |
| `offered` | `active`    | **the user, by accepting it, inside its window**          |
| `active`  | `completed` | the weekly batch, when `evaluateChallenge` says it is met |

**Only `active` settles.** A challenge the user never accepted does not pay,
however completely their training happens to satisfy it.

**WHY, when the earlier behaviour paid out either way:** an Accept control that
does not gate the reward is a control that does nothing, and this project does
not ship those — it is the same reasoning that keeps the unit toggle off the
profile until conversion exists. Accepting is the only place a user says _yes,
this one_, and if the XP arrives regardless then the Hub is a noticeboard rather
than somewhere a decision is made.

**The cost, stated rather than discovered:** a user who never opens the Hub
earns no challenge XP. Adherence XP, streak milestones and achievements are
untouched — those reward training, and training is not what accepting is about.
Challenges are the opt-in half of the game.

**Accepting is a state transition, not a claim.** It carries no numbers. The
user is choosing which challenge is in play; whether it was _met_ is still
derived from logged rows by `evaluateChallenge`, exactly as before, so the phase
4 criterion — no completion can be granted from the client — is untouched by
this. Because `challenges` has read-only RLS and no write policy, the transition
runs through a `security definer` function like every other write in
`src/gamification/`, and the status filter inside its `UPDATE` is what makes a
second press a no-op rather than a second acceptance.

**Accepting is refused past `window_end`**, and the refusal is in the function
rather than only in the surface — a button is a courtesy, not a control.

**The date is the user's, never the server's** (CLAUDE.md #9). `window_end` was
written from the user's local today, so it has to be compared against the user's
local today. Comparing it to a server date hides the last hours of a window from
anyone west of UTC — behind a button that renders and then refuses — and grants
an extra day to anyone east of it.

**An expired challenge is left `offered`.** Nothing marks it `failed`. That is a
gap rather than a decision: it means the Hub accumulates challenges whose window
has closed, and the surface has to say so rather than offer an Accept button
that would put a dead challenge in play.

**A known gap, wider than it looks.** `evaluateChallenge` derives a rolling
window from `asOf` and never reads `window_start`/`window_end`, so an accepted
challenge that is never met stays `active` and settles the first time the user's
rolling activity meets its target — arbitrarily far past the window the row
records. Accepting is gated on the window; **completing is not**. This predates
the accept control and is narrowed rather than widened by it, since the same row
previously paid out with no acceptance at all. Closing it means either skipping
settlement past `window_end` or marking expired rows `failed`, and passing the
row's own window into the evaluator instead of deriving one.
