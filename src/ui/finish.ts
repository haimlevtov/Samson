/**
 * The decisions behind the finish moment — the Quest Log redesign, ADR 0033 —
 * and, since ADR 0034, behind a rest day's receipt too.
 *
 * INVARIANT: every figure these take was written by `award_session_xp` or read
 *            from the metrics engine. They choose a sentence or a link; they
 *            compute no reward, and none of them can make a session worth more.
 */
import type { WorkoutStatus } from '../metrics/types';

/** What the receipt is about, and whether there is a session behind it to review. */
export interface Receipt {
  title: string;
  noun: 'session' | 'rest day';
  reviewable: boolean;
}

/**
 * Which workouts get a receipt, and what it says — null for one that has not
 * resolved as kept, which the page sends back to the session.
 *
 * WHY a rest day gets one — ADR 0034 §6: `award_session_xp` pays it and may
 * unlock a badge on it, and the receipt is the screen a badge fires on. It has
 * no "Review the session": there is no session.
 */
/**
 * Where a kept workout lands: its receipt, carrying the first badge the award
 * unlocked so the sheet fires there.
 *
 * WHY a query parameter is safe: it selects which badge to REVEAL, and the page
 * renders it only after finding a matching row in this user's own unlocked
 * achievements. A forged slug shows nothing, because the event has to exist.
 *
 * AI-NOTE: `finishWorkout` and `logRestDay` both land through this. Tested,
 *          because the two used to build the URL separately.
 */
export function keptPath(workoutId: string, unlocked: readonly string[]): string {
  const kept = `/history/${encodeURIComponent(workoutId)}/kept`;
  const first = unlocked[0];
  return first === undefined ? kept : `${kept}?unlocked=${encodeURIComponent(first)}`;
}

export function receiptFor(status: WorkoutStatus): Receipt | null {
  if (status === 'completed') return { title: 'Session kept', noun: 'session', reviewable: true };
  if (status === 'rest') return { title: 'Rest day kept', noun: 'rest day', reviewable: false };
  return null;
}

/**
 * The sentence under the emblem.
 *
 * WHY three cases and not two: nothing recorded can mean the week's ceiling was
 * already spent — a rule working — or that the award call failed, which
 * `finishWorkout` and `logRestDay` swallow on purpose so a saved workout never
 * shows an error page. Only a spent ceiling is a claim this page can make; the other says only
 * what it knows. _It said "yet" until review pointed out nothing ever retries a
 * failed award, so "yet" promised a later that does not come._
 */
export function earnedSentence(input: {
  earned: number;
  weekXp: number;
  ceiling: number;
  noun?: Receipt['noun'];
}): string {
  const noun = input.noun ?? 'session';
  if (input.earned > 0) {
    // A rest day sits on the same curve as a session — migration 20260902100000.
    return noun === 'rest day'
      ? 'A rest day pays what a session in its place would. Load never changes the number.'
      : 'Each session in a week pays a little less than the one before. Load never changes the number.';
  }
  if (input.weekXp >= input.ceiling) {
    return `That week's cap was reached — the ${noun} still counts for your streak and adherence.`;
  }
  return `No XP is recorded for this ${noun}. It still counts for your streak and adherence.`;
}

/**
 * What one session's own ledger rows add up to.
 *
 * `award_session_xp` writes a row per thing the session earned — adherence, a
 * streak milestone, an achievement — each with this `workout_id`, bounded by the
 * weekly ceiling trigger. The sum restates what the award granted; it decides
 * nothing. Tested, because a page that added them wrong would print a reward the
 * ledger does not hold.
 */
export function sessionXp(rows: readonly { amount: number; source: string }[]): {
  earned: number;
  milestone: boolean;
} {
  return {
    earned: rows.reduce((sum, row) => sum + row.amount, 0),
    milestone: rows.some((row) => row.source === 'streak'),
  };
}
