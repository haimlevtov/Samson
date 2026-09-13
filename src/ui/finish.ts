/**
 * The decisions behind the finish moment — the Quest Log redesign, ADR 0033.
 *
 * INVARIANT: every figure these take was written by `award_session_xp` or read
 *            from the metrics engine. They choose a sentence or a link; they
 *            compute no reward, and none of them can make a session worth more.
 */

/**
 * The sentence under the emblem.
 *
 * WHY three cases and not two: nothing recorded can mean the week's ceiling was
 * already spent — a rule working — or that the award call failed, which
 * `finishWorkout` swallows on purpose so a saved session never shows an error
 * page. Only a spent ceiling is a claim this page can make; the other says only
 * what it knows. _It said "yet" until review pointed out nothing ever retries a
 * failed award, so "yet" promised a later that does not come._
 */
export function earnedSentence(input: { earned: number; weekXp: number; ceiling: number }): string {
  if (input.earned > 0) {
    return 'Each session in a week pays a little less than the one before. Load never changes the number.';
  }
  if (input.weekXp >= input.ceiling) {
    return "That week's cap was reached — the session still counts for your streak and adherence.";
  }
  return 'No XP is recorded for this session. It still counts for your streak and adherence.';
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
