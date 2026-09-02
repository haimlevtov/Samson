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
  | 'unknown_exercise'
  /**
   * A spec that cannot be measured as written — today, only a `sets_at_rpe`
   * challenge with no `rpe_at_least`.
   *
   * WHY it is not `reward_out_of_band`: it was reported under that code, which
   * says the reward is wrong when the reward is fine and the threshold is
   * missing. `validation_reasons` is written to the row precisely so a human
   * can read why a candidate was rejected, and a wrong code makes that worse
   * than silence.
   */
  | 'missing_threshold';

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
 * The most this spec could reach in its window, or null when nothing bounds it.
 *
 * `sessions` and `streak_days` are both counted per DAY by `evaluateChallenge`,
 * so a window of n days holds at most n of either. That is a property of the
 * evaluator, not of reality — the schema permits several workout rows on one
 * date and `startWorkout` creates one per call — which is why the two have to
 * be read together. AI-NOTE: if `sessions` ever counts rows again, this bound
 * becomes false and a same-day pair completes a multi-day challenge.
 *
 * `distinct_exercises` is bounded by what the user can actually train: their
 * equipment-filtered candidate list. Without that bound a bodyweight-only user
 * was offered "five distinct movements this week" against two available, and
 * nothing rejected it — the target was unreachable, not merely hard.
 */
function maxAchievable(spec: ChallengeSpec, context: ChallengeContext): number | null {
  switch (spec.kind) {
    case 'sessions':
    case 'streak_days':
      return spec.window_days;
    case 'distinct_exercises':
      return context.availableExerciseIds.length;
    // A day holds any number of sets, so the window alone bounds nothing.
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

  const ceiling = maxAchievable(spec, context);
  if (ceiling !== null && spec.target > ceiling) {
    reasons.push({
      code: 'target_unreachable',
      detail:
        spec.kind === 'distinct_exercises'
          ? `target ${spec.target} exceeds the ${ceiling} exercises this user can train`
          : `target ${spec.target} exceeds the ${ceiling} possible in a ${spec.window_days}-day window`,
    });
  }

  /*
   * WHY the band and not the weekly ceiling: MAX_REWARD_XP is 150 and the
   * ceiling is 500, so any reward that clears the band is already payable and
   * the ceiling comparison can never fire. Checking only the ceiling — as this
   * did — meant `reward_out_of_band` was unreachable through the schema, and a
   * stale row carrying 300 validated clean. The spec defines the code as
   * "reward_xp outside 10..150", which is what this now measures.
   */
  if (spec.reward_xp < MIN_REWARD_XP || spec.reward_xp > MAX_REWARD_XP) {
    reasons.push({
      code: 'reward_out_of_band',
      detail: `reward ${spec.reward_xp} is outside the ${MIN_REWARD_XP}..${MAX_REWARD_XP} band (the weekly ceiling is ${WEEKLY_XP_CEILING})`,
    });
  }

  if (spec.kind === 'sets_at_rpe' && spec.rpe_at_least === null) {
    reasons.push({
      code: 'missing_threshold',
      detail: 'a sets_at_rpe challenge needs an rpe_at_least threshold to measure against',
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
        /*
         * Distinct DAYS with a completed workout, not completed workout rows.
         *
         * WHY: nothing stops several sessions on one date — `workouts` has no
         * unique constraint on (user_id, local_date), `startWorkout` inserts a
         * row per call, and scripts/seed.ts says so explicitly. Counting rows
         * meant "three sessions this week" was finished by starting and
         * finishing three workouts in one afternoon, which is not the training
         * pattern the challenge is asking for. Counting days also makes
         * `maxAchievable`'s window bound true rather than assumed.
         */
        return new Set(
          inWindow(context.workouts)
            .filter((w) => w.status === 'completed')
            .map((w) => w.localDate)
        ).size;

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
