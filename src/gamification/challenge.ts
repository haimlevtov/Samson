/**
 * Challenges and daily quests — one validator, two questions.
 *
 * PLAN.md phase 4 asks for "daily quests reusing the challenge validator with a
 * shorter window". A quest is therefore a challenge with `window_days: 1`, and
 * there is no second code path. A separate quest evaluator would be a second
 * definition of what completion means, and the two would drift.
 *
 * INVARIANT: completion is derived from logged rows, never submitted — ADR 0009
 *            and PLAN.md phase 4's "no completion can be granted from the
 *            client". Nothing in this file reads a claim about what the user
 *            did; it reads what they logged.
 *
 * Contract: `docs/specs/xp-and-challenges.md`.
 */
import { z } from 'zod';
import { addDays, isWithin } from '../metrics/dates';
import { currentStreak } from '../metrics/adherence';
import type { LocalDate, SetRecord, WorkoutRecord } from '../metrics/types';
import { plausibleSets } from './plausibility';
import { WEEKLY_XP_CEILING } from './xp';

// ---------------------------------------------------------------------------
// The spec shape
// ---------------------------------------------------------------------------

export const MIN_REWARD_XP = 10;
export const MAX_REWARD_XP = 150;

/**
 * AI-NOTE: this is the schema for `challenges.spec`, a jsonb column. It is
 *          validated on read as well as on write — a row written by an older
 *          version of the generator is untrusted input like any other.
 */
export const challengeSpecSchema = z.strictObject({
  kind: z.enum(['sessions', 'distinct_exercises', 'sets_at_rpe', 'streak_days']),
  target: z.int().min(1).max(50),
  window_days: z.int().min(1).max(14),
  reward_xp: z.int().min(MIN_REWARD_XP).max(MAX_REWARD_XP),
  /** Only meaningful for `sets_at_rpe`; null everywhere else. */
  rpe_at_least: z.number().min(1).max(10).nullable(),
});
export type ChallengeSpec = z.infer<typeof challengeSpecSchema>;

export type ChallengeKind = 'daily' | 'weekly';

/** What the user has actually done, for both validation and evaluation. */
export interface ChallengeContext {
  workouts: readonly WorkoutRecord[];
  sets: readonly SetRecord[];
  /** History for plausibility, excluding `sets`. */
  history: readonly SetRecord[];
  asOf: LocalDate;
  /** Slugs the user can actually train, for `unknown_exercise`. */
  availableExerciseIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Question one: is this worth offering?
// ---------------------------------------------------------------------------

export type RejectionCode =
  | 'target_unreachable'
  | 'below_current_ability'
  | 'reward_out_of_band'
  | 'window_mismatch'
  | 'unknown_exercise';

export interface ValidationReason {
  code: RejectionCode;
  /** Names the offending number — the same reasoning as RuleConstraint, ADR 0008. */
  detail: string;
}

export interface CandidateVerdict {
  ok: boolean;
  reasons: ValidationReason[];
}

/**
 * A day cannot contain more than one session, so a `sessions` target above the
 * window length is arithmetically impossible rather than merely hard.
 */
function maxAchievable(spec: ChallengeSpec): number | null {
  switch (spec.kind) {
    case 'sessions':
    case 'streak_days':
      return spec.window_days;
    // Volume-shaped targets have no hard ceiling from the window alone.
    case 'distinct_exercises':
    case 'sets_at_rpe':
      return null;
  }
}

/**
 * Is this candidate worth offering at all?
 *
 * WHY this is separate from `evaluateChallenge`: a challenge can be perfectly
 * well-formed and simply not finished yet, which is the normal case for every
 * active challenge in the system. Recording that as a rejection would make
 * `validation_reasons` meaningless.
 */
export function validateCandidate(
  spec: ChallengeSpec,
  kind: ChallengeKind,
  context: ChallengeContext
): CandidateVerdict {
  const reasons: ValidationReason[] = [];

  // A daily quest whose window is not one day is not a daily quest.
  if (kind === 'daily' && spec.window_days !== 1) {
    reasons.push({
      code: 'window_mismatch',
      detail: `a daily challenge must have window_days 1, not ${spec.window_days}`,
    });
  }

  const ceiling = maxAchievable(spec);
  if (ceiling !== null && spec.target > ceiling) {
    reasons.push({
      code: 'target_unreachable',
      detail: `target ${spec.target} exceeds the ${ceiling} possible in a ${spec.window_days}-day window`,
    });
  }

  if (spec.reward_xp > WEEKLY_XP_CEILING) {
    reasons.push({
      code: 'reward_out_of_band',
      detail: `reward ${spec.reward_xp} exceeds the ${WEEKLY_XP_CEILING} weekly XP ceiling, so it could never be paid in full`,
    });
  }

  if (spec.kind === 'sets_at_rpe' && spec.rpe_at_least === null) {
    reasons.push({
      code: 'reward_out_of_band',
      detail: 'a sets_at_rpe challenge needs an rpe_at_least threshold',
    });
  }

  /*
   * Already met without changing anything. This is the check that stops the
   * generator offering "train once this week" to someone who trains five times,
   * which is not a challenge but a free reward.
   */
  const { progress } = evaluateChallenge(spec, context);
  if (progress >= spec.target) {
    reasons.push({
      code: 'below_current_ability',
      detail: `already at ${progress} against a target of ${spec.target} before starting`,
    });
  }

  if (context.availableExerciseIds.length === 0 && spec.kind === 'distinct_exercises') {
    reasons.push({
      code: 'unknown_exercise',
      detail: 'a distinct_exercises challenge needs at least one available exercise',
    });
  }

  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Question two: has it been completed?
// ---------------------------------------------------------------------------

export interface ChallengeProgress {
  met: boolean;
  progress: number;
  target: number;
}

const KEPT = new Set(['completed', 'rest']);

/**
 * Progress toward a challenge, from logged data only.
 *
 * INVARIANT: implausible sets are excluded before anything is counted — the
 *            spec's plausibility section. A typo must not complete a challenge.
 */
export function evaluateChallenge(
  spec: ChallengeSpec,
  context: ChallengeContext
): ChallengeProgress {
  const start = addDays(context.asOf, -(spec.window_days - 1));
  const inWindow = <T extends { localDate: LocalDate }>(rows: readonly T[]): T[] =>
    rows.filter((r) => isWithin(r.localDate, start, context.asOf));

  const countable = plausibleSets(context.sets, context.history);
  const progress = ((): number => {
    switch (spec.kind) {
      case 'sessions':
        return inWindow(context.workouts).filter((w) => w.status === 'completed').length;

      case 'distinct_exercises':
        return new Set(inWindow(countable).map((s) => s.exerciseId)).size;

      case 'sets_at_rpe': {
        const threshold = spec.rpe_at_least;
        // A missing threshold makes the challenge unmeasurable. Zero progress is
        // the honest answer; validateCandidate rejects the spec separately.
        if (threshold === null) return 0;
        return inWindow(countable).filter((s) => (s.rpe ?? 0) >= threshold).length;
      }

      case 'streak_days':
        // WHY the whole workout list and not the window: a streak is a property
        // of the run up to today, and truncating the history would report a
        // streak shorter than the one the user actually has.
        return Math.min(currentStreak(context.workouts, context.asOf), spec.window_days);
    }
  })();

  return { met: progress >= spec.target, progress, target: spec.target };
}

/** Whether a workout status counts as kept, exported so the UI agrees with the rules. */
export function isKeptStatus(status: string): boolean {
  return KEPT.has(status);
}
