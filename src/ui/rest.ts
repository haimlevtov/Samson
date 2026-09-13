/**
 * What Quick start on the Workout tab offers for today's rest day — ADR 0034.
 *
 * INVARIANT: this chooses a control, never a reward. Whether a rest day pays,
 *            and how much, is `award_session_xp`'s alone — ADR 0009.
 */
import type { WorkoutStatus } from '../metrics/types';

export type RestToday =
  /** Nothing that settles the day yet: offer Rest today. */
  | { kind: 'offer' }
  /** Already a rest day: link to its receipt rather than offer a second. */
  | { kind: 'rested'; workoutId: string }
  /** A session is in the day: it is not a day off — ADR 0034 §4. */
  | { kind: 'trained' };

/** A workout that makes the day a training day. `planned` and `skipped` do not. */
const A_SESSION: ReadonlySet<WorkoutStatus> = new Set<WorkoutStatus>(['completed', 'in_progress']);

/**
 * Decides from the day's own workouts, read in the user's local date.
 *
 * WHY a logged rest day wins over a session beside it: ADR 0034 §4 lets a user
 * train on a day already logged as rest, and the rest day stays. Quick start
 * then still says the day was a rest day, because it was, instead of offering
 * a second one or claiming the day was only ever a training day.
 */
export function restToday(todays: readonly { id: string; status: WorkoutStatus }[]): RestToday {
  const rest = todays.find((w) => w.status === 'rest');
  if (rest !== undefined) return { kind: 'rested', workoutId: rest.id };
  if (todays.some((w) => A_SESSION.has(w.status))) return { kind: 'trained' };
  return { kind: 'offer' };
}
