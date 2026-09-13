import { describe, expect, it } from 'vitest';
import { earnedSentence, sessionHeadline } from './finish';

describe('sessionHeadline', () => {
  it('counts the session in words up to ten', () => {
    expect(sessionHeadline(1)).toBe('First session this week');
    expect(sessionHeadline(3)).toBe('Third session this week');
    expect(sessionHeadline(10)).toBe('Tenth session this week');
  });

  it('uses digits with the right suffix past ten', () => {
    expect(sessionHeadline(11)).toBe('11th session this week');
    expect(sessionHeadline(12)).toBe('12th session this week');
    expect(sessionHeadline(21)).toBe('21st session this week');
    expect(sessionHeadline(22)).toBe('22nd session this week');
    expect(sessionHeadline(23)).toBe('23rd session this week');
  });

  it('says nothing it cannot count', () => {
    expect(sessionHeadline(0)).toBe('Session kept');
    expect(sessionHeadline(Number.NaN)).toBe('Session kept');
    expect(sessionHeadline(2.5)).toBe('Session kept');
  });
});

describe('earnedSentence', () => {
  it('explains the taper when something was earned', () => {
    expect(earnedSentence({ earned: 70, thisWeek: 280, ceiling: 500 })).toMatch(
      /less than the one before/
    );
  });

  it('names the cap only when the cap is what stopped it', () => {
    expect(earnedSentence({ earned: 0, thisWeek: 500, ceiling: 500 })).toMatch(/cap is reached/);
  });

  it('never blames the cap for nothing recorded below it', () => {
    // An award call that failed is swallowed by finishWorkout; the page must
    // not invent a reason.
    const sentence = earnedSentence({ earned: 0, thisWeek: 200, ceiling: 500 });
    expect(sentence).not.toMatch(/cap/);
    expect(sentence).toMatch(/streak and adherence/);
  });
});
