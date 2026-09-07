/**
 * Tests for `src/gamification/settlement.ts`.
 *
 * The gap this module closes, recorded in docs/plans/phase-4.md: challenges
 * were generated, validated, assigned and rendered, and nothing ever finished
 * one or paid it. The half of "server-side verification of every completion"
 * that existed was the verification.
 */
import { describe, expect, it } from 'vitest';
import { settleChallenges, type AssignedChallenge } from './settlement';
import type { ChallengeContext, ChallengeSpec } from './challenge';
import { WEEKLY_XP_CEILING } from './xp';
import type { WorkoutRecord, WorkoutStatus } from '../metrics/types';

const TODAY = '2026-09-06';

function spec(over: Partial<ChallengeSpec> = {}): ChallengeSpec {
  return {
    kind: 'sessions',
    target: 2,
    window_days: 7,
    reward_xp: 50,
    rpe_at_least: null,
    ...over,
  };
}

function challenge(over: Partial<AssignedChallenge> = {}): AssignedChallenge {
  // Accepted by default: only an accepted challenge settles, so an 'offered'
  // fixture would make every test below assert nothing.
  return { id: 'c-1', slug: 'weekly-two', spec: spec(), status: 'active', ...over };
}

function workout(localDate: string, status: WorkoutStatus = 'completed'): WorkoutRecord {
  return { id: `w-${localDate}`, localDate, status };
}

function context(over: Partial<ChallengeContext> = {}): ChallengeContext {
  return {
    workouts: [workout('2026-09-05'), workout('2026-09-06')],
    sets: [],
    history: [],
    asOf: TODAY,
    availableExerciseIds: ['squat-id'],
    ...over,
  };
}

describe('settleChallenges', () => {
  it('settles a challenge the user has finished', () => {
    const settled = settleChallenges([challenge()], context(), 0);

    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({ slug: 'weekly-two', progress: 2, target: 2, awardXp: 50 });
  });

  it('leaves an unfinished challenge alone', () => {
    // Two sessions logged against a target of five is the normal state of every
    // active challenge, and settling it would be paying for work not done.
    const settled = settleChallenges([challenge({ spec: spec({ target: 5 }) })], context(), 0);
    expect(settled).toEqual([]);
  });

  it('does not re-settle a challenge that is already resolved', () => {
    for (const status of ['completed', 'failed', 'rejected']) {
      expect(settleChallenges([challenge({ status })], context(), 0), status).toEqual([]);
    }
  });

  /*
   * The rule accepting exists for. This is the same context that settles an
   * accepted challenge in the first test above — the ONLY difference is that
   * nobody pressed Accept, and that has to be enough to withhold the payout or
   * the Hub's control does nothing.
   */
  it('does not settle a challenge the user never accepted', () => {
    expect(settleChallenges([challenge({ status: 'offered' })], context(), 0)).toEqual([]);
  });

  it('settles the accepted one and leaves its unaccepted twin', () => {
    const settled = settleChallenges(
      [
        challenge({ id: 'accepted', slug: 'taken', status: 'active' }),
        challenge({ id: 'ignored', slug: 'untaken', status: 'offered' }),
      ],
      context(),
      0
    );

    expect(settled.map((s) => s.id)).toEqual(['accepted']);
  });

  it('clamps a payout to what the week has left', () => {
    const settled = settleChallenges([challenge()], context(), WEEKLY_XP_CEILING - 20);

    expect(settled[0]?.rewardXp, 'what the spec promised').toBe(50);
    expect(settled[0]?.awardXp, 'what the week could pay').toBe(20);
  });

  it('settles a challenge into an exhausted week, paying nothing', () => {
    /*
     * The user did the work, so the challenge is finished and recorded as such.
     * Leaving it unsettled would mean re-evaluating it forever, and would show
     * a completed challenge as still active. The ceiling caps the payout, not
     * the achievement.
     */
    const settled = settleChallenges([challenge()], context(), WEEKLY_XP_CEILING);

    expect(settled).toHaveLength(1);
    expect(settled[0]?.awardXp).toBe(0);
  });

  it('applies the ceiling across the whole batch, not per challenge', () => {
    // Three finished challenges worth 50 each, with 60 left in the week. Each
    // one fits on its own; together they do not.
    const challenges = [
      challenge({ id: 'a', slug: 'aaa' }),
      challenge({ id: 'b', slug: 'bbb' }),
      challenge({ id: 'c', slug: 'ccc' }),
    ];

    const settled = settleChallenges(challenges, context(), WEEKLY_XP_CEILING - 60);
    const paid = settled.reduce((sum, s) => sum + s.awardXp, 0);

    expect(settled).toHaveLength(3);
    expect(paid, 'the batch cannot jointly breach the ceiling').toBe(60);
    expect(settled.map((s) => s.awardXp)).toEqual([50, 10, 0]);
  });

  it('is deterministic, whatever order the rows arrive in', () => {
    // The ceiling makes order observable, so it cannot be the database's.
    const forwards = [challenge({ id: 'a', slug: 'aaa' }), challenge({ id: 'b', slug: 'bbb' })];
    const backwards = [...forwards].reverse();

    const left = settleChallenges(forwards, context(), WEEKLY_XP_CEILING - 60);
    const right = settleChallenges(backwards, context(), WEEKLY_XP_CEILING - 60);

    expect(left).toEqual(right);
  });

  it('does not let an implausible set finish a challenge', () => {
    /*
     * Settlement inherits the plausibility boundary because it calls
     * evaluateChallenge rather than reimplementing it — which is the whole
     * reason this module does not derive completion for itself.
     */
    const history = [
      {
        exerciseId: 'squat-id',
        weightKg: 100,
        reps: 5,
        rpe: 8,
        isWarmup: false,
        localDate: '2026-08-01',
      },
    ];
    const typo = [
      {
        exerciseId: 'squat-id',
        weightKg: 400,
        reps: 5,
        rpe: 8,
        isWarmup: false,
        localDate: TODAY,
      },
    ];

    const settled = settleChallenges(
      [challenge({ spec: spec({ kind: 'distinct_exercises', target: 1 }) })],
      context({ workouts: [], sets: typo, history }),
      0
    );

    expect(settled).toEqual([]);
  });
});
