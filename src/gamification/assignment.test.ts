/**
 * What `assignFromPool` decides, and what it refuses to decide.
 *
 * The function is the one definition of "which pool templates become this
 * user's challenges" — shared by `scripts/generate-challenges.ts` (the weekly
 * cron) and `scripts/seed.ts` (the demo database). Before it existed the cron
 * held the only copy and the seeder held none, which is why three demo users
 * opened an empty Hub.
 *
 * `validateCandidate` is tested next door in `challenge.test.ts`; this covers
 * the parts that are only true of the assignment step — the window arithmetic,
 * the two ways a template produces no row at all, and the fact that the verdict
 * is carried rather than reinterpreted.
 */
import { describe, expect, it } from 'vitest';
import { assignFromPool, type PoolTemplate } from './assignment';
import type { ChallengeContext } from './challenge';
import type { SetRecord, WorkoutRecord } from '../metrics/types';

const ASOF = '2026-09-09';

/** A user who has done nothing, so nothing is `below_current_ability`. */
function untrainedContext(overrides: Partial<ChallengeContext> = {}): ChallengeContext {
  return {
    workouts: [],
    sets: [],
    history: [],
    asOf: ASOF,
    availableExerciseIds: ['ex-1', 'ex-2', 'ex-3', 'ex-4', 'ex-5', 'ex-6'],
    ...overrides,
  };
}

const weekly = (over: Record<string, unknown> = {}): PoolTemplate => ({
  slug: 'weekly-three-sessions',
  kind: 'weekly',
  spec: { kind: 'sessions', target: 3, window_days: 7, reward_xp: 80, rpe_at_least: null, ...over },
});

describe('the window a challenge is assigned for', () => {
  it('opens today and closes on the last day of its window, inclusive', () => {
    const { assignments } = assignFromPool([weekly()], untrainedContext(), []);

    expect(assignments[0]?.windowStart).toBe(ASOF);
    // Seven days INCLUDING today, so the sixth day after it — not the seventh.
    expect(assignments[0]?.windowEnd).toBe('2026-09-15');
  });

  it('opens and closes on the same day for a daily quest', () => {
    /*
     * The off-by-one that would matter: `window_days: 1` closing tomorrow makes
     * a daily quest acceptable for two days, and `accept_challenge`'s window
     * check is the only thing that would ever notice.
     */
    const daily: PoolTemplate = {
      slug: 'daily-one-session',
      kind: 'daily',
      spec: { kind: 'sessions', target: 1, window_days: 1, reward_xp: 25, rpe_at_least: null },
    };
    const { assignments } = assignFromPool([daily], untrainedContext(), []);

    expect(assignments[0]?.windowStart).toBe(ASOF);
    expect(assignments[0]?.windowEnd).toBe(ASOF);
  });

  it('measures backward to decide and forward to assign', () => {
    /*
     * The shape of the whole feature, in one assertion. The user trained three
     * days in the week BEHIND `asOf`, so "three sessions" is refused as
     * something they already do — while the window written on the row is the
     * week AHEAD.
     */
    const workouts: WorkoutRecord[] = ['2026-09-07', '2026-09-08', '2026-09-09'].map(
      (localDate, i) => ({ id: `w${i}`, localDate, status: 'completed' as const })
    );
    const { assignments } = assignFromPool([weekly()], untrainedContext({ workouts }), []);

    expect(assignments[0]?.status).toBe('rejected');
    expect(assignments[0]?.reasons.map((r) => r.code)).toEqual(['below_current_ability']);
    expect(assignments[0]?.windowStart).toBe(ASOF);
    expect(assignments[0]?.windowEnd).toBe('2026-09-15');
  });
});

describe('templates that produce no row at all', () => {
  it('skips one the user already has, by slug', () => {
    const { assignments, skipped } = assignFromPool([weekly()], untrainedContext(), [
      'weekly-three-sessions',
    ]);

    expect(assignments).toEqual([]);
    expect(skipped).toEqual([{ slug: 'weekly-three-sessions', reason: 'already_assigned' }]);
  });

  it('skips one whose spec does not parse, rather than throwing', () => {
    /*
     * A pool row is jsonb written by an older generator, so it is untrusted
     * input. The batch touches every user in one pass: one bad row must not
     * take the run down, and it must not be silent either — the caller logs
     * what came back in `skipped`.
     */
    const broken: PoolTemplate = { slug: 'broken', kind: 'weekly', spec: { kind: 'nonsense' } };
    const { assignments, skipped } = assignFromPool([broken, weekly()], untrainedContext(), []);

    expect(skipped).toEqual([{ slug: 'broken', reason: 'unparseable_spec' }]);
    expect(assignments.map((a) => a.slug)).toEqual(['weekly-three-sessions']);
  });

  it('tells the two kinds of skip apart', () => {
    // They are logged differently — an unparseable pool row is a content bug,
    // an already-assigned one is the ordinary case — so the codes have to differ.
    const broken: PoolTemplate = { slug: 'broken', kind: 'weekly', spec: null };
    const { skipped } = assignFromPool([broken, weekly()], untrainedContext(), [
      'weekly-three-sessions',
    ]);

    expect(skipped.map((s) => s.reason)).toEqual(['unparseable_spec', 'already_assigned']);
  });
});

describe('the verdict is carried, not re-derived', () => {
  it('writes a rejected row with its reasons rather than dropping it', () => {
    /*
     * INVARIANT: a rejected challenge is inspectable — PLAN.md phase 4. A
     * dropped row is not inspectable, and `validation_reasons` is written from
     * exactly this field.
     */
    const impossible = weekly({ target: 9 }); // nine sessions in a seven-day window
    const { assignments } = assignFromPool([impossible], untrainedContext(), []);

    expect(assignments[0]?.status).toBe('rejected');
    expect(assignments[0]?.reasons.map((r) => r.code)).toEqual(['target_unreachable']);
    expect(assignments[0]?.reasons[0]?.detail).toContain('9');
  });

  it('carries every reason, not just the first', () => {
    // `validation_reasons` is a list because a candidate can fail several ways
    // at once, and a reader of the Hub's "not offered" list sees all of them.
    const wrong: PoolTemplate = { slug: 'wrong', kind: 'daily', spec: weekly({ target: 40 }).spec };
    const { assignments } = assignFromPool([wrong], untrainedContext(), []);

    expect(assignments[0]?.reasons.map((r) => r.code).sort()).toEqual([
      'target_unreachable',
      'window_mismatch',
    ]);
  });

  it('keeps the pool order, which is what makes a seeded database reproducible', () => {
    // scripts/seed.ts accepts one of these, chosen by position. If the order
    // came back from a Set or a Map the demo database would differ per run.
    const pool = [weekly({ target: 2 }), weekly({ target: 3 }), weekly({ target: 4 })].map(
      (t, i) => ({ ...t, slug: `s${i}` })
    );
    const { assignments } = assignFromPool(pool, untrainedContext(), []);

    expect(assignments.map((a) => a.slug)).toEqual(['s0', 's1', 's2']);
  });
});

describe('the pool a consistent lifter is offered', () => {
  /*
   * The failure this whole PR exists for. A pool calibrated at or below what
   * the user already does offers them NOTHING — three of the five seeded
   * archetypes were in that state, and every rejection carried the same code,
   * so a count of rejected rows looked like the feature working.
   *
   * tests/db/challenges.test.ts asserts the fix against the real pool and the
   * real seeded users, and sweeps seven weekdays. This pins the shape of the
   * failure, offline, so the next person to add a pool row can see what
   * "calibrated" means.
   *
   * Only the failing direction is here. FOUND IN REVIEW: the passing one —
   * "a harder rung is offered to the same user" — is `validateCandidate`'s
   * behaviour, not `assignFromPool`'s, and `challenge.test.ts` already owns it
   * beside the code that would break it. That is where it should fail.
   */
  const days = ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07'];
  const workouts: WorkoutRecord[] = days.map((localDate, i) => ({
    id: `w${i}`,
    localDate,
    status: 'completed' as const,
  }));
  const sets: SetRecord[] = days.flatMap((localDate) =>
    ['ex-1', 'ex-2', 'ex-3'].map((exerciseId) => ({
      exerciseId,
      weightKg: 60,
      reps: 5,
      rpe: 8,
      isWarmup: false,
      localDate,
    }))
  );
  const consistent = untrainedContext({ workouts, sets, history: sets });

  it('offers nothing at all when every target is already met', () => {
    const easyPool = [weekly({ target: 3 }), { ...weekly({ target: 4 }), slug: 'four' }];
    const { assignments } = assignFromPool(easyPool, consistent, []);

    expect(assignments.map((a) => a.status)).toEqual(['rejected', 'rejected']);
    expect(new Set(assignments.flatMap((a) => a.reasons.map((r) => r.code)))).toEqual(
      new Set(['below_current_ability'])
    );
  });
});
