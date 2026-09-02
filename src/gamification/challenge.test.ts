/**
 * Tests for `src/gamification/challenge.ts`, from
 * `docs/specs/xp-and-challenges.md`.
 *
 * Two acceptance criteria land here:
 *   - "A rejected challenge is inspectable — the validator logs why"
 *   - "No completion can be granted from the client" (the offline half; the
 *     enforced half is RLS and lives in tests/db/)
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_REWARD_XP,
  challengeSpecSchema,
  evaluateChallenge,
  validateCandidate,
  type ChallengeContext,
  type ChallengeSpec,
} from './challenge';
import { WEEKLY_XP_CEILING } from './xp';
import type { SetRecord, WorkoutRecord, WorkoutStatus } from '../metrics/types';

const TODAY = '2026-09-06';
const SQUAT = 'squat-id';
const BENCH = 'bench-id';

function spec(over: Partial<ChallengeSpec> = {}): ChallengeSpec {
  return {
    kind: 'sessions',
    target: 3,
    window_days: 7,
    reward_xp: 50,
    rpe_at_least: null,
    ...over,
  };
}

function workout(localDate: string, status: WorkoutStatus = 'completed'): WorkoutRecord {
  return { id: `w-${localDate}-${status}`, localDate, status };
}

function set(over: Partial<SetRecord> = {}): SetRecord {
  return {
    exerciseId: SQUAT,
    weightKg: 100,
    reps: 5,
    rpe: 8,
    isWarmup: false,
    localDate: TODAY,
    ...over,
  };
}

function context(over: Partial<ChallengeContext> = {}): ChallengeContext {
  return {
    workouts: [],
    sets: [],
    history: [],
    asOf: TODAY,
    availableExerciseIds: [SQUAT, BENCH],
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe('challengeSpecSchema', () => {
  it('accepts a well-formed spec', () => {
    expect(challengeSpecSchema.safeParse(spec()).success).toBe(true);
  });

  it('rejects a reward outside the band', () => {
    expect(challengeSpecSchema.safeParse(spec({ reward_xp: 5 })).success).toBe(false);
    expect(challengeSpecSchema.safeParse(spec({ reward_xp: MAX_REWARD_XP + 1 })).success).toBe(
      false
    );
  });

  it('rejects an unknown key, so a stale row cannot smuggle a field', () => {
    expect(challengeSpecSchema.safeParse({ ...spec(), bonus: 1000 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// "A rejected challenge is inspectable"
// ---------------------------------------------------------------------------

describe('validateCandidate', () => {
  it('accepts a challenge that asks for more than the user currently does', () => {
    const verdict = validateCandidate(spec({ target: 4 }), 'weekly', context());
    expect(verdict.ok).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it('rejects a target the window cannot physically hold', () => {
    const verdict = validateCandidate(spec({ target: 10, window_days: 3 }), 'weekly', context());

    expect(verdict.ok).toBe(false);
    const reason = verdict.reasons.find((r) => r.code === 'target_unreachable');
    expect(reason).toBeDefined();
    // The criterion is inspectability: the reason has to name the numbers.
    expect(reason?.detail).toContain('10');
    expect(reason?.detail).toContain('3');
  });

  it('rejects a daily quest whose window is not a day', () => {
    const verdict = validateCandidate(spec({ window_days: 7 }), 'daily', context());
    expect(verdict.reasons.map((r) => r.code)).toContain('window_mismatch');
  });

  it('rejects a challenge the user has already met without changing anything', () => {
    const done = context({
      workouts: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'].map((d) => workout(d)),
    });
    const verdict = validateCandidate(spec({ target: 3 }), 'weekly', done);

    expect(verdict.ok).toBe(false);
    const reason = verdict.reasons.find((r) => r.code === 'below_current_ability');
    expect(reason?.detail).toContain('4');
  });

  it('rejects a reward the weekly ceiling could never pay', () => {
    // Constructed past the schema band deliberately: a stale row could hold it.
    const verdict = validateCandidate(
      { ...spec(), reward_xp: WEEKLY_XP_CEILING + 1 },
      'weekly',
      context()
    );
    expect(verdict.reasons.map((r) => r.code)).toContain('reward_out_of_band');
  });

  it('rejects a reward outside the band even when the ceiling could pay it', () => {
    /*
     * 300 is over MAX_REWARD_XP and comfortably under the weekly ceiling. The
     * validator used to compare only against the ceiling, so this exact row —
     * the stale-spec case the check exists for — validated clean.
     */
    const verdict = validateCandidate({ ...spec(), reward_xp: 300 }, 'weekly', context());

    const reason = verdict.reasons.find((r) => r.code === 'reward_out_of_band');
    expect(reason).toBeDefined();
    expect(reason?.detail).toContain('300');
    expect(reason?.detail).toContain(String(MAX_REWARD_XP));
  });

  it('rejects an rpe challenge with no threshold to measure, and says so', () => {
    const verdict = validateCandidate(
      spec({ kind: 'sets_at_rpe', rpe_at_least: null }),
      'weekly',
      context()
    );

    // Not `reward_out_of_band`: the reward is fine, the threshold is missing,
    // and validation_reasons is read by humans.
    expect(verdict.reasons.map((r) => r.code)).toContain('missing_threshold');
    expect(verdict.reasons.map((r) => r.code)).not.toContain('reward_out_of_band');
  });

  it('rejects more distinct exercises than the user can actually train', () => {
    // A bodyweight-only user: two movements available, five demanded.
    const limited = context({ availableExerciseIds: [SQUAT, BENCH] });
    const verdict = validateCandidate(
      spec({ kind: 'distinct_exercises', target: 5 }),
      'weekly',
      limited
    );

    const reason = verdict.reasons.find((r) => r.code === 'target_unreachable');
    expect(reason, 'an impossible target must not be offered').toBeDefined();
    expect(reason?.detail).toContain('5');
    expect(reason?.detail).toContain('2');
  });

  it('still offers a distinct-exercises target the candidate list can hold', () => {
    const verdict = validateCandidate(
      spec({ kind: 'distinct_exercises', target: 2 }),
      'weekly',
      context()
    );
    expect(verdict.ok).toBe(true);
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const verdict = validateCandidate(
      spec({ target: 40, window_days: 3, reward_xp: WEEKLY_XP_CEILING + 1 }),
      'daily',
      context()
    );
    expect(verdict.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it('gives every reason a non-empty detail', () => {
    const verdict = validateCandidate(spec({ target: 40, window_days: 2 }), 'daily', context());
    for (const reason of verdict.reasons) {
      expect(reason.detail.trim().length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Completion, from logged rows only
// ---------------------------------------------------------------------------

describe('evaluateChallenge', () => {
  it('counts completed sessions inside the window', () => {
    const ctx = context({
      workouts: [workout('2026-09-04'), workout('2026-09-05'), workout('2026-09-06')],
    });
    expect(evaluateChallenge(spec({ target: 3 }), ctx)).toEqual({
      met: true,
      progress: 3,
      target: 3,
    });
  });

  it('ignores sessions outside the window', () => {
    const ctx = context({
      workouts: [workout('2026-08-01'), workout('2026-08-02'), workout('2026-09-06')],
    });
    expect(evaluateChallenge(spec({ target: 3 }), ctx).progress).toBe(1);
  });

  it('does not count a rest day toward a sessions challenge', () => {
    // Rest keeps a streak and earns XP; it is not a training session.
    const ctx = context({ workouts: [workout('2026-09-05', 'rest'), workout('2026-09-06')] });
    expect(evaluateChallenge(spec({ target: 2 }), ctx).progress).toBe(1);
  });

  it('counts a day once, however many sessions were started on it', () => {
    /*
     * Nothing in the schema stops several workout rows sharing a date, and
     * `startWorkout` creates one per call. Counting rows meant "three sessions
     * this week" was completed by starting and finishing three in one
     * afternoon.
     */
    const ctx = context({
      workouts: [
        { ...workout('2026-09-06'), id: 'w-1' },
        { ...workout('2026-09-06'), id: 'w-2' },
        { ...workout('2026-09-06'), id: 'w-3' },
      ],
    });
    expect(evaluateChallenge(spec({ target: 3 }), ctx).progress).toBe(1);
  });

  it('counts distinct exercises, not sets', () => {
    const ctx = context({
      sets: [set(), set(), set({ exerciseId: BENCH })],
    });
    expect(evaluateChallenge(spec({ kind: 'distinct_exercises', target: 2 }), ctx).progress).toBe(
      2
    );
  });

  it('counts sets at or above the rpe threshold', () => {
    const ctx = context({
      sets: [set({ rpe: 9 }), set({ rpe: 8 }), set({ rpe: 6 }), set({ rpe: null })],
    });
    expect(
      evaluateChallenge(spec({ kind: 'sets_at_rpe', target: 2, rpe_at_least: 8 }), ctx).progress
    ).toBe(2);
  });

  /*
   * The plausibility boundary. A typo must not complete a challenge — otherwise
   * the cheapest way to finish one is to mistype a weight.
   */
  it('excludes implausible sets from progress', () => {
    const history = [set({ localDate: '2026-08-01' })];
    const ctx = context({
      sets: [set({ exerciseId: BENCH }), set({ weightKg: 400 })],
      history,
    });

    // Only the bench set counts; the 400 kg squat is over 1.5x the established best.
    expect(evaluateChallenge(spec({ kind: 'distinct_exercises', target: 2 }), ctx).progress).toBe(
      1
    );
  });

  /*
   * The other half of the plausibility boundary, and the cheaper exploit of the
   * two: no typo required, just three empty-bar sets.
   */
  it('does not let warmups complete a distinct-exercises challenge', () => {
    const ctx = context({
      sets: [
        set({ exerciseId: SQUAT, weightKg: 20, isWarmup: true }),
        set({ exerciseId: BENCH, weightKg: 20, isWarmup: true }),
        set({ exerciseId: 'press-id', weightKg: 20, isWarmup: true }),
      ],
    });
    expect(evaluateChallenge(spec({ kind: 'distinct_exercises', target: 3 }), ctx).progress).toBe(
      0
    );
  });

  it('does not let warmups complete an rpe challenge', () => {
    const ctx = context({
      sets: [
        set({ weightKg: 20, rpe: 9, isWarmup: true }),
        set({ weightKg: 20, rpe: 9, isWarmup: true }),
      ],
    });
    expect(
      evaluateChallenge(spec({ kind: 'sets_at_rpe', target: 2, rpe_at_least: 8 }), ctx).progress
    ).toBe(0);
  });

  it('still counts the working sets alongside warmups', () => {
    const ctx = context({
      sets: [set({ exerciseId: SQUAT, weightKg: 20, isWarmup: true }), set({ exerciseId: BENCH })],
    });
    expect(evaluateChallenge(spec({ kind: 'distinct_exercises', target: 1 }), ctx).progress).toBe(
      1
    );
  });

  it('reports a streak without truncating it to the window', () => {
    const days = [
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ];
    const ctx = context({ workouts: days.map((d) => workout(d)) });
    expect(evaluateChallenge(spec({ kind: 'streak_days', target: 5 }), ctx).met).toBe(true);
  });

  it('reports zero progress rather than throwing on an unmeasurable spec', () => {
    const ctx = context({ sets: [set({ rpe: 10 })] });
    const result = evaluateChallenge(spec({ kind: 'sets_at_rpe', rpe_at_least: null }), ctx);
    expect(result.progress).toBe(0);
    expect(result.met).toBe(false);
  });

  it('is not met on an empty history', () => {
    expect(evaluateChallenge(spec(), context()).met).toBe(false);
  });
});
