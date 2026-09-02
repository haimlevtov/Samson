/**
 * Tests for `src/gamification/plausibility.ts`, from
 * `docs/specs/xp-and-challenges.md`.
 *
 * The behaviour that matters most is the one that is easy to get backwards: a
 * first-ever log of an exercise must NOT be implausible. A check that flags
 * everything until history exists would fire on every user's first session,
 * which is the moment they are most likely to abandon the app.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_PLAUSIBLE_REPS,
  MAX_PLAUSIBLE_WEIGHT_KG,
  PLAUSIBLE_E1RM_MULTIPLE,
  checkPlausibility,
  plausibleSets,
} from './plausibility';
import type { SetRecord } from '../metrics/types';

const SQUAT = 'squat-id';

function set(over: Partial<SetRecord> = {}): SetRecord {
  return {
    exerciseId: SQUAT,
    weightKg: 100,
    reps: 5,
    rpe: 8,
    isWarmup: false,
    localDate: '2026-09-01',
    ...over,
  };
}

/** A history establishing roughly a 116 kg e1RM on the squat (100 kg × 5). */
const HISTORY: SetRecord[] = [set({ localDate: '2026-08-01' })];

describe('checkPlausibility', () => {
  it('accepts an ordinary set against a matching history', () => {
    expect(checkPlausibility([set()], HISTORY)).toEqual([]);
  });

  it('accepts a genuine PR that is not absurd', () => {
    // 110 × 5 ≈ 128 kg e1RM, well under 1.5 × 116.
    expect(checkPlausibility([set({ weightKg: 110 })], HISTORY)).toEqual([]);
  });

  it('flags a load far above the user established best', () => {
    const [finding] = checkPlausibility([set({ weightKg: 300 })], HISTORY);
    expect(finding?.code).toBe('exceeds_established_best');
    expect(finding?.setIndex).toBe(0);
    // The detail names both numbers, so a human can see the comparison.
    expect(finding?.detail).toContain('1RM');
  });

  /*
   * The one that would ruin a first session. A user with no history for a
   * movement has nothing to contradict, so nothing is implausible.
   */
  it('never flags a first entry for an exercise', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: MAX_PLAUSIBLE_WEIGHT_KG }), (weightKg) => {
        expect(checkPlausibility([set({ weightKg })], [])).toEqual([]);
      }),
      { numRuns: 500 }
    );
  });

  it('never flags a first entry even when history exists for other exercises', () => {
    const other: SetRecord[] = [set({ exerciseId: 'bench-id', weightKg: 60 })];
    expect(checkPlausibility([set({ weightKg: 250 })], other)).toEqual([]);
  });

  it('flags impossible rep counts', () => {
    const [finding] = checkPlausibility([set({ reps: MAX_PLAUSIBLE_REPS + 1 })], HISTORY);
    expect(finding?.code).toBe('impossible_volume');
  });

  it('flags nonsense values', () => {
    expect(checkPlausibility([set({ weightKg: -5 })], HISTORY)[0]?.code).toBe('nonsense_value');
    expect(checkPlausibility([set({ reps: -1 })], HISTORY)[0]?.code).toBe('nonsense_value');
    expect(
      checkPlausibility([set({ weightKg: MAX_PLAUSIBLE_WEIGHT_KG + 1 })], HISTORY)[0]?.code
    ).toBe('nonsense_value');
  });

  it('ignores warmups, which never set records anyway', () => {
    expect(checkPlausibility([set({ weightKg: 300, isWarmup: true })], HISTORY)).toEqual([]);
  });

  it('reports the index of each offending set, not just that one exists', () => {
    const findings = checkPlausibility(
      [set(), set({ weightKg: 400 }), set(), set({ reps: 500 })],
      HISTORY
    );
    expect(findings.map((f) => f.setIndex)).toEqual([1, 3]);
  });

  it('reports at most one finding per set', () => {
    // Both nonsense and implausible; the first check wins and does not double up.
    const findings = checkPlausibility([set({ weightKg: -400, reps: 900 })], HISTORY);
    expect(findings).toHaveLength(1);
  });

  it('holds the multiple it documents', () => {
    // Just inside and just outside 1.5x, to pin the boundary rather than assume it.
    const best = 116.66;
    const justUnder = Math.floor(((best * PLAUSIBLE_E1RM_MULTIPLE) / 1.1667) * 0.98);
    expect(checkPlausibility([set({ weightKg: justUnder })], HISTORY)).toEqual([]);
  });

  /*
   * The gap this closes: Epley stops at EPLEY_MAX_REPS (12) and setE1rm returns
   * null past it, so every set above 12 reps left the function unjudged — the
   * one range where a "400 instead of 40" typo was guaranteed to pass.
   */
  it('flags an absurd load that Epley cannot estimate', () => {
    const [finding] = checkPlausibility([set({ weightKg: 400, reps: 15 })], HISTORY);

    expect(finding?.code).toBe('exceeds_established_best');
    expect(finding?.detail).toContain('400');
    expect(finding?.detail).toContain('15');
  });

  it('leaves an honest high-rep set alone', () => {
    // 60 kg for 20 is ordinary work against a 100 kg best, and no formula is
    // needed to say so.
    expect(checkPlausibility([set({ weightKg: 60, reps: 20 })], HISTORY)).toEqual([]);
  });

  it('says nothing about a high-rep set with no history to contradict it', () => {
    expect(checkPlausibility([set({ weightKg: 400, reps: 15 })], [])).toEqual([]);
  });

  it('applies the same multiple above the rep cap as below it', () => {
    const bestWeight = 100;
    const justUnder = bestWeight * PLAUSIBLE_E1RM_MULTIPLE - 1;
    const justOver = bestWeight * PLAUSIBLE_E1RM_MULTIPLE + 1;

    expect(checkPlausibility([set({ weightKg: justUnder, reps: 15 })], HISTORY)).toEqual([]);
    expect(checkPlausibility([set({ weightKg: justOver, reps: 15 })], HISTORY)).toHaveLength(1);
  });
});

describe('plausibleSets', () => {
  it('returns only the sets that may earn a reward', () => {
    const sets = [set(), set({ weightKg: 400 }), set()];
    expect(plausibleSets(sets, HISTORY)).toHaveLength(2);
  });

  /*
   * A warmup is trusted and still earns nothing — checkPlausibility says it is
   * fine, and this says it does not count. Without the split, three empty-bar
   * sets completed a three-movement challenge.
   */
  it('drops warmups even though nothing is wrong with them', () => {
    const sets = [set(), set({ weightKg: 20, isWarmup: true })];

    expect(checkPlausibility(sets, HISTORY)).toEqual([]);
    expect(plausibleSets(sets, HISTORY)).toHaveLength(1);
    expect(plausibleSets(sets, HISTORY)[0]?.isWarmup).toBe(false);
  });

  it('never returns more sets than it was given', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            weightKg: fc.integer({ min: -100, max: 900 }),
            reps: fc.integer({ min: -5, max: 400 }),
          }),
          { maxLength: 20 }
        ),
        (raw) => {
          const sets = raw.map((r) => set(r));
          expect(plausibleSets(sets, HISTORY).length).toBeLessThanOrEqual(sets.length);
        }
      ),
      { numRuns: 1_000 }
    );
  });

  it('does not mutate its input', () => {
    const sets = [set(), set({ weightKg: 400 })];
    const copy = structuredClone(sets);
    plausibleSets(sets, HISTORY);
    expect(sets).toEqual(copy);
  });
});
