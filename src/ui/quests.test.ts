/**
 * Tests for `src/ui/quests.ts`. A title is read as a promise about what earns
 * XP, so the cases here are the ones where a wrong word would be a wrong rule.
 */
import { describe, expect, it } from 'vitest';
import type { ChallengeSpec } from '../gamification/challenge';
import { ICON_NAMES } from './icons';
import { challengeIcon, challengeTitle, initialOf, remainingPhrase } from './quests';

const spec = (over: Partial<ChallengeSpec>): ChallengeSpec => ({
  kind: 'sessions',
  target: 3,
  window_days: 7,
  reward_xp: 80,
  rpe_at_least: null,
  ...over,
});

describe('challengeTitle', () => {
  it('names what each kind measures, and over which window', () => {
    expect(challengeTitle(spec({}), 'weekly-three-sessions')).toBe('Three sessions in seven days');
    expect(
      challengeTitle(spec({ kind: 'distinct_exercises', window_days: 1 }), 'daily-three-movements')
    ).toBe('Three different exercises today');
    expect(challengeTitle(spec({ kind: 'sets_at_rpe', target: 8, rpe_at_least: 8 }), 'x')).toBe(
      'Eight hard sets in seven days'
    );
    expect(challengeTitle(spec({ kind: 'streak_days', target: 5 }), 'x')).toBe('A five-day streak');
    // An article that follows the sound, not the letter.
    for (const [target, title] of [
      [8, 'An eight-day streak'],
      [11, 'An eleven-day streak'],
      [14, 'A fourteen-day streak'],
    ] as const) {
      expect(challengeTitle(spec({ kind: 'streak_days', target, window_days: 14 }), 'x')).toBe(
        title
      );
    }
  });

  it('keeps the singular singular', () => {
    expect(challengeTitle(spec({ target: 1, window_days: 1 }), 'x')).toBe('One session today');
    expect(challengeTitle(spec({ kind: 'sets_at_rpe', target: 1 }), 'x')).toBe(
      'One hard set in seven days'
    );
  });

  it('never says "this week" for a rolling window', () => {
    // evaluateChallenge counts the last N days ending today; Hub's header names
    // the calendar week. The title must not borrow the calendar's word.
    for (const kind of ['sessions', 'distinct_exercises', 'sets_at_rpe'] as const) {
      expect(challengeTitle(spec({ kind }), 'x')).not.toMatch(/week/);
    }
  });

  it('says a longer window in days', () => {
    expect(challengeTitle(spec({ window_days: 14, target: 6 }), 'x')).toBe(
      'Six sessions in fourteen days'
    );
  });

  it('uses digits past twenty, which the spec allows up to fifty', () => {
    expect(challengeTitle(spec({ kind: 'sets_at_rpe', target: 25 }), 'x')).toBe(
      '25 hard sets in seven days'
    );
  });

  it('falls back to the slug for a spec that could not be read', () => {
    expect(challengeTitle(null, 'weekly-eight-hard-sets')).toBe('weekly eight hard sets');
  });
});

describe('challengeIcon', () => {
  it('draws a one-day window as a sunrise whatever it asks for', () => {
    for (const kind of ['sessions', 'distinct_exercises', 'sets_at_rpe', 'streak_days'] as const) {
      expect(challengeIcon(spec({ kind, window_days: 1 }))).toBe('sunrise');
    }
  });

  it('draws every kind with an icon that exists', () => {
    for (const kind of ['sessions', 'distinct_exercises', 'sets_at_rpe', 'streak_days'] as const) {
      expect(ICON_NAMES).toContain(challengeIcon(spec({ kind })));
    }
    expect(ICON_NAMES).toContain(challengeIcon(null));
  });
});

describe('remainingPhrase', () => {
  it('says what is left in the unit the challenge counts', () => {
    expect(remainingPhrase(spec({}), 2)).toBe('one more session to go');
    expect(remainingPhrase(spec({ kind: 'sets_at_rpe', target: 8 }), 3)).toBe(
      'five more hard sets to go'
    );
    expect(remainingPhrase(spec({ kind: 'streak_days', target: 5 }), 4)).toBe(
      'one more kept day to go'
    );
  });

  it('says a met challenge pays on the weekly run, never now', () => {
    expect(remainingPhrase(spec({}), 3)).toBe('complete · pays on the next weekly run');
    // Progress past the target is still met — sessions can pass it; a streak
    // cannot, because evaluateChallenge caps it at the window.
    expect(remainingPhrase(spec({}), 9)).toBe('complete · pays on the next weekly run');
  });
});

describe('initialOf', () => {
  it('takes the first letter, upper-cased', () => {
    expect(initialOf('dan (plateaued)')).toBe('D');
  });

  it('keeps a whole character, never half of one', () => {
    expect(initialOf('\u{1F3CB}\uFE0F lifter')).toBe('\u{1F3CB}\uFE0F');
    expect(initialOf('e\u0301mile')).toBe('E\u0301');
  });

  it('gives something to draw for a name that is only space', () => {
    expect(initialOf('   ')).toBe('?');
  });
});
