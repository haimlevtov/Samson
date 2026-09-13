import { describe, expect, it } from 'vitest';
import { earnedSentence, sessionXp } from './finish';

describe('earnedSentence', () => {
  it('explains the taper when something was earned', () => {
    expect(earnedSentence({ earned: 70, weekXp: 280, ceiling: 500 })).toMatch(
      /less than the one before/
    );
  });

  it('names the cap only when the cap is what stopped it', () => {
    expect(earnedSentence({ earned: 0, weekXp: 500, ceiling: 500 })).toMatch(/cap was reached/);
  });

  it('never blames the cap, or promises a retry, for nothing recorded below it', () => {
    // A failed award is swallowed by finishWorkout and never retried.
    const sentence = earnedSentence({ earned: 0, weekXp: 200, ceiling: 500 });
    expect(sentence).not.toMatch(/cap/);
    expect(sentence).not.toMatch(/\byet\b/);
    expect(sentence).toMatch(/streak and adherence/);
  });
});

describe('sessionXp', () => {
  it('adds every row the award wrote for the session', () => {
    expect(
      sessionXp([
        { amount: 64, source: 'adherence' },
        { amount: 50, source: 'streak' },
        { amount: 75, source: 'achievement' },
      ])
    ).toEqual({ earned: 189, milestone: true });
  });

  it('is nothing, and no milestone, with no rows', () => {
    expect(sessionXp([])).toEqual({ earned: 0, milestone: false });
  });
});
