/**
 * XP — the reward arithmetic.
 *
 * INVARIANT: XP derives from adherence, never volume — CLAUDE.md #4. There is
 *            deliberately no tonnage parameter in this file. Volume-scaled XP
 *            pays people to overtrain, and `xp_events.source` omits a `volume`
 *            value for the same reason.
 *
 * INVARIANT: the LLM never computes a number — CLAUDE.md #1. Every figure a
 *            user sees on the progress screen comes from here.
 *
 * The contract is `docs/specs/xp-and-challenges.md` and it is authoritative. If
 * behaviour and spec disagree, one of them is a bug — decide which, then change
 * both.
 *
 * Pure over plain shapes, like `src/metrics/`: no database, no clock, no
 * randomness. The property tests in `xp.test.ts` generate thousands of session
 * sequences against it, which only works because nothing here reaches outward.
 *
 * AI-NOTE: `WEEKLY_XP_CEILING` is duplicated by a database trigger — ADR 0009.
 *          That duplication is deliberate and pinned by a test in tests/db/. If
 *          you change the constant here, the migration changes too, or the
 *          pinning test fails and tells you so.
 */
import { isWithin } from '../metrics/dates';
import type { LocalDate, WorkoutRecord, WorkoutStatus } from '../metrics/types';

/** One kept session, at full price. Every other award is measured against this. */
export const SESSION_BASE_XP = 100;

/**
 * WHY 0.8 and not a steeper curve: the seventh session of a week still earns 26
 * XP, which is a quarter of the first rather than nothing. A curve that decayed
 * to zero would tell a six-day-a-week lifter that their last session was
 * worthless, which is both false and the kind of thing that makes someone stop
 * logging.
 */
export const DIMINISH_FACTOR = 0.8;

/**
 * WHY 500 when seven kept sessions only earn 395: the ceiling is meant to bind
 * on a week that also pays out streak milestones, an achievement and a
 * challenge — not on a week of ordinary training. A cap that fired on normal
 * adherence would be a punishment for consistency, which inverts the point.
 */
export const WEEKLY_XP_CEILING = 500;

export const ACHIEVEMENT_XP = 75;

export const STREAK_MILESTONES = [7, 14, 30, 60, 100] as const;
export const STREAK_MILESTONE_XP = 50;

/**
 * INVARIANT: mirrors the `xp_events.source` check constraint exactly. A value
 *            here that the constraint does not accept is an insert that fails
 *            at runtime rather than at compile time.
 */
export type XpSource = 'adherence' | 'streak' | 'achievement' | 'challenge' | 'quest';

export interface XpAward {
  source: XpSource;
  /** Never negative. Enforced by every function that constructs one. */
  amount: number;
  /** Shown to the user, so it says what was earned rather than naming a code. */
  reason: string;
}

export interface WeekWindow {
  start: LocalDate;
  end: LocalDate;
}

/**
 * Statuses that earn.
 *
 * WHY `rest` earns the same as `completed`: a scheduled rest day is the plan
 * being followed — logged for today on the Workout tab, ADR 0034. This is the same set `adherence()` treats as kept, and the two
 * must not drift — a rest day that counted for adherence but earned no XP would
 * teach the user that resting is punished, which is invariant #4 defeated by
 * arithmetic instead of by prompt.
 */
const EARNS: ReadonlySet<WorkoutStatus> = new Set<WorkoutStatus>(['completed', 'rest']);

/**
 * XP for the nth kept session of a week, 1-indexed.
 *
 * Returns 0 for n < 1 rather than throwing: callers derive n from a count, and
 * a count of zero is an ordinary state, not an error.
 */
export function sessionXp(nth: number): number {
  if (nth < 1) return 0;
  return Math.round(SESSION_BASE_XP * DIMINISH_FACTOR ** (nth - 1));
}

/**
 * Every award a week's workouts earn, before the ceiling is applied.
 *
 * WHY the ceiling is NOT applied here: `weeklyAwards` answers "what did this
 * week earn", and the ceiling is a fact about what has already been paid out —
 * which this function cannot see and should not guess at. Keeping them separate
 * is what lets the caller apply the cap against the real ledger balance.
 */
export function weeklyAwards(workouts: readonly WorkoutRecord[], week: WeekWindow): XpAward[] {
  const kept = workouts
    .filter((w) => isWithin(w.localDate, week.start, week.end))
    .filter((w) => EARNS.has(w.status))
    // Date order, so "the nth session of the week" means the nth chronologically
    // and not the nth in whatever order the caller happened to load rows.
    .sort((a, b) => (a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0));

  return kept.map((workout, index) => ({
    source: 'adherence' as const,
    amount: sessionXp(index + 1),
    reason:
      workout.status === 'rest'
        ? `rest day kept (session ${index + 1} this week)`
        : `session ${index + 1} this week`,
  }));
}

/**
 * Milestone awards crossed by moving from `previous` to `current`.
 *
 * WHY it takes both numbers rather than just the current streak: an award has to
 * fire once, on the day the milestone is crossed. Given only `current`, day 8 of
 * a streak is indistinguishable from day 7 and the 7-day milestone would pay
 * again every day thereafter.
 *
 * A streak that went backwards (a missed day) crosses nothing and earns nothing.
 */
export function streakAwards(previous: number, current: number): XpAward[] {
  return STREAK_MILESTONES.filter((m) => m > previous && m <= current).map((milestone) => ({
    source: 'streak' as const,
    amount: STREAK_MILESTONE_XP,
    reason: `${milestone}-day streak`,
  }));
}

/**
 * Clamps a proposed award to what the week has left.
 *
 * INVARIANT: never returns a negative number. An `alreadyAwarded` above the
 *            ceiling should be unreachable — the clamp runs before every
 *            insert, and the trigger in ADR 0009 refuses anything that got past
 *            it — but "unreachable" is a claim about callers, not about this
 *            function, so it is defined for that case anyway.
 */
export function applyCeiling(alreadyAwarded: number, proposed: number): number {
  return Math.max(0, Math.min(proposed, WEEKLY_XP_CEILING - alreadyAwarded));
}

/**
 * Applies the ceiling across a list in order, returning what may actually be
 * written.
 *
 * WHY awards are clamped in sequence rather than proportionally scaled: a
 * partially-paid award is still a real award with a real reason attached, and
 * scaling every entry by some fraction would produce a ledger full of amounts
 * that match no rule. Earlier awards are paid in full until the cap is reached;
 * the rest are dropped.
 *
 * AI-NOTE: zero-amount awards are omitted rather than kept at 0. `xp_events`
 *          rows exist to explain a balance, and a row saying "you earned
 *          nothing" explains nothing.
 */
export function awardsWithinCeiling(alreadyAwarded: number, awards: readonly XpAward[]): XpAward[] {
  const granted: XpAward[] = [];
  let running = alreadyAwarded;

  for (const award of awards) {
    const amount = applyCeiling(running, award.amount);
    if (amount === 0) continue;
    granted.push({ ...award, amount });
    running += amount;
  }

  return granted;
}

/** Convenience for a ledger balance or a proposed batch. */
export function totalXp(awards: readonly XpAward[]): number {
  return awards.reduce((sum, a) => sum + a.amount, 0);
}
