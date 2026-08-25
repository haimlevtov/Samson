/**
 * Adherence — did the user do what the plan asked?
 *
 * INVARIANT: XP derives from adherence, never volume — CLAUDE.md #4.
 * This module is therefore the input to every XP calculation in phase 4, which
 * is why a rest day counts as kept rather than missed.
 */
import { compareDates, isWithin } from './dates';
import type { LocalDate, WorkoutRecord, WorkoutStatus } from './types';

/**
 * WHY 'rest' counts as adherent: a scheduled rest day is the plan being
 * followed, not skipped. Counting it against the user would make the app reward
 * training through a deload, which is the exact behaviour invariant #4 exists to
 * prevent.
 */
const KEPT: ReadonlySet<WorkoutStatus> = new Set<WorkoutStatus>(['completed', 'rest']);

/**
 * WHY 'planned' and 'in_progress' are absent: a day that has not resolved yet is
 * not evidence either way. Counting a future session as missed would drag
 * adherence down every time a plan is generated.
 */
const RESOLVED: ReadonlySet<WorkoutStatus> = new Set<WorkoutStatus>([
  'completed',
  'rest',
  'skipped',
]);

export interface AdherenceWindow {
  start: LocalDate;
  end: LocalDate;
}

export interface AdherenceResult {
  /** 0..1, or null when nothing in the window has resolved yet. */
  rate: number | null;
  kept: number;
  resolved: number;
}

/**
 * Returns null rather than 0 for an empty window.
 *
 * WHY: "no scheduled sessions" and "missed every session" are opposite facts,
 *      and a 0 would let the coach berate a user who has not started yet.
 */
export function adherence(
  workouts: readonly WorkoutRecord[],
  window?: AdherenceWindow
): AdherenceResult {
  let kept = 0;
  let resolved = 0;

  for (const workout of workouts) {
    if (window && !isWithin(workout.localDate, window.start, window.end)) continue;
    if (!RESOLVED.has(workout.status)) continue;
    resolved += 1;
    if (KEPT.has(workout.status)) kept += 1;
  }

  return { rate: resolved === 0 ? null : kept / resolved, kept, resolved };
}

/**
 * Consecutive kept days ending at `asOf`, walking backwards.
 *
 * WHY this counts planned days rather than calendar days: PLAN.md phase 4 says
 * scheduled rest maintains a streak. A day with no scheduled session is neither
 * kept nor broken — it is skipped over, so an every-other-day programme does not
 * reset the streak on its off days.
 */
export function currentStreak(workouts: readonly WorkoutRecord[], asOf: LocalDate): number {
  const resolved = workouts
    .filter((w) => RESOLVED.has(w.status) && compareDates(w.localDate, asOf) <= 0)
    .sort((a, b) => compareDates(b.localDate, a.localDate));

  let streak = 0;
  for (const workout of resolved) {
    if (!KEPT.has(workout.status)) break;
    streak += 1;
  }
  return streak;
}
