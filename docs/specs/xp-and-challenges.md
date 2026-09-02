# Spec — XP, streaks and challenges

Status: authoritative
Date: 2026-09-02
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
- **`impossible_volume`** — more than 100 reps in a single set.
- **`nonsense_value`** — a negative weight or reps, or a weight above 500 kg.

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

| Code                    | Meaning                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| `target_unreachable`    | the target cannot fit in the window — 10 sessions in 3 days           |
| `below_current_ability` | the user already does this without changing anything; not a challenge |
| `reward_out_of_band`    | `reward_xp` outside 10..150, or above what the weekly ceiling can pay |
| `window_mismatch`       | a `daily` challenge whose `window_days` is not 1                      |
| `unknown_exercise`      | references a slug outside the user's candidate list                   |

Each finding carries a `detail` naming the offending number, for the same reason
`RuleConstraint` exists in the planner (ADR 0008): a human reads the detail, and
anything acting on it reads the fields.

### Completion — `evaluateChallenge`

Returns `{ met: boolean; progress: number; target: number }`.

**Completion is derived from logged rows only.** Nothing the client sends is
input. This is the phase's "no completion can be granted from the client"
criterion, and `docs/adr/0009-gamification-trust.md` records how it is enforced
rather than merely intended.

Sets failing `checkPlausibility` are excluded from `progress` before it is
compared with `target`.
