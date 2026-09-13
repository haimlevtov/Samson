/**
 * What Quick start on the Workout tab offers for today's rest day — ADR 0034.
 *
 * INVARIANT: this chooses a control, never a reward. Whether a rest day pays,
 *            and how much, is `award_session_xp`'s alone — ADR 0009.
 */
import type { DayWorkout } from '../db/training';

export type RestToday =
  /** Nothing that settles the day yet: offer Rest today. */
  | { kind: 'offer' }
  /** Already a rest day: link to its receipt rather than offer a second. */
  | { kind: 'rested'; workoutId: string }
  /** The day has training in it: it is not a day off — ADR 0034 §4. */
  | { kind: 'trained' };

/**
 * Decides from the day's own workouts, read in the user's local date.
 *
 * WHY a logged rest day wins over training beside it: ADR 0034 §4 lets a user
 * train on a day already logged as rest, and the rest day stays. Quick start
 * then still says the day was a rest day, because it was, instead of offering
 * a second one or claiming the day was only ever a training day.
 *
 * WHY training means a finished or open session WITH SETS, and not any session
 * row — FOUND IN REVIEW. An empty session is a mis-tap on the Start button just
 * above this one, or one abandoned before a set; nothing in the app deletes
 * either, so counting it blocked Rest today for the rest of the day with no way
 * out. A session still RUNNING never reaches this function: the page gives it
 * the whole of Quick start and the action sends it back to Resume.
 */
export function restToday(todays: readonly DayWorkout[]): RestToday {
  const rest = todays.find((w) => w.status === 'rest');
  if (rest !== undefined) return { kind: 'rested', workoutId: rest.id };
  const trained = todays.some(
    (w) => (w.status === 'completed' || w.status === 'in_progress') && w.setCount > 0
  );
  return trained ? { kind: 'trained' } : { kind: 'offer' };
}
