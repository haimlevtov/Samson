import { describe, expect, it } from 'vitest';
import { earnedSentence, keptPath, receiptFor, sessionXp } from './finish';

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

describe('earnedSentence for a rest day — ADR 0034', () => {
  it('says a rest day, not a session, in every case', () => {
    for (const input of [
      { earned: 100, weekXp: 100, ceiling: 500 },
      { earned: 0, weekXp: 500, ceiling: 500 },
      { earned: 0, weekXp: 0, ceiling: 500 },
    ]) {
      const sentence = earnedSentence({ ...input, noun: 'rest day' });
      expect(sentence, JSON.stringify(input)).toMatch(/rest day/);
      expect(sentence, JSON.stringify(input)).not.toMatch(
        /\bsession (still|in a week)|this session/
      );
    }
  });
});

describe('keptPath', () => {
  it('lands on the receipt, with no parameter when nothing unlocked', () => {
    expect(keptPath('w-1', [])).toBe('/history/w-1/kept');
  });

  it('carries the first unlocked badge, encoded, so the sheet fires there', () => {
    expect(keptPath('w-1', ['ten-rest-days', 'first-full-week'])).toBe(
      '/history/w-1/kept?unlocked=ten-rest-days'
    );
    expect(keptPath('a/b', ['x&y'])).toBe('/history/a%2Fb/kept?unlocked=x%26y');
  });
});

describe('receiptFor', () => {
  it('gives a finished session its receipt, with the session to review', () => {
    expect(receiptFor('completed')).toEqual({
      title: 'Session kept',
      noun: 'session',
      reviewable: true,
    });
  });

  it('gives a rest day a receipt too — the screen its badge fires on — with nothing to review', () => {
    expect(receiptFor('rest')).toEqual({
      title: 'Rest day kept',
      noun: 'rest day',
      reviewable: false,
    });
  });

  it('gives nothing that has not resolved as kept a receipt', () => {
    for (const status of ['planned', 'in_progress', 'skipped'] as const) {
      expect(receiptFor(status), status).toBeNull();
    }
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
