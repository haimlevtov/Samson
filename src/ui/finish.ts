/**
 * The words of the finish moment — the Quest Log redesign, ADR 0033.
 *
 * INVARIANT: every figure these take was written by `award_session_xp` or read
 *            from the metrics engine. They choose a sentence; they compute no
 *            reward, and none of them can make a session worth more.
 */

const ORDINALS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
];

/** "Third session this week". Past the tenth, digits: "12th session this week". */
export function sessionHeadline(sessionsThisWeek: number): string {
  if (!Number.isInteger(sessionsThisWeek) || sessionsThisWeek < 1) return 'Session kept';
  const word = ORDINALS[sessionsThisWeek - 1];
  if (word !== undefined) {
    return `${word.charAt(0).toUpperCase()}${word.slice(1)} session this week`;
  }
  const n = sessionsThisWeek;
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : n % 10 === 1
        ? 'st'
        : n % 10 === 2
          ? 'nd'
          : n % 10 === 3
            ? 'rd'
            : 'th';
  return `${n}${suffix} session this week`;
}

/**
 * The sentence under the emblem.
 *
 * WHY three cases and not two: nothing recorded can mean the week's ceiling was
 * already spent — a rule working — or that the award call failed, which
 * `finishWorkout` swallows on purpose so a saved session never shows an error
 * page. Only a spent ceiling is a claim this page can make; the other says only
 * what it knows.
 */
export function earnedSentence(input: {
  earned: number;
  thisWeek: number;
  ceiling: number;
}): string {
  if (input.earned > 0) {
    return 'Each session in a week pays a little less than the one before. Load never changes the number.';
  }
  if (input.thisWeek >= input.ceiling) {
    return "The week's cap is reached — the session still counts for your streak and adherence.";
  }
  return 'No XP is recorded for this session yet. It still counts for your streak and adherence.';
}
