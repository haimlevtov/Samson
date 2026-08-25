import { describe, expect, it } from 'vitest';
import { EPLEY_MAX_REPS, bestE1rm, epleyE1rm, setE1rm } from './e1rm';
import type { SetRecord } from './types';

const set = (over: Partial<SetRecord> = {}): SetRecord => ({
  exerciseId: 'squat',
  weightKg: 100,
  reps: 5,
  isWarmup: false,
  localDate: '2026-08-24',
  ...over,
});

describe('epleyE1rm', () => {
  it('matches the formula on known cases', () => {
    // 100 × (1 + 5/30) = 116.666…
    expect(epleyE1rm(100, 5)).toBeCloseTo(116.6667, 4);
    expect(epleyE1rm(60, 10)).toBeCloseTo(80, 6);
    expect(epleyE1rm(142.5, 3)).toBeCloseTo(156.75, 6);
  });

  it('treats a single as measured, not estimated', () => {
    expect(epleyE1rm(180, 1)).toBe(180);
  });

  it('returns null past the rep range where Epley holds', () => {
    expect(epleyE1rm(60, EPLEY_MAX_REPS)).not.toBeNull();
    expect(epleyE1rm(60, EPLEY_MAX_REPS + 1)).toBeNull();
    expect(epleyE1rm(60, 20)).toBeNull();
  });

  it('returns null for unloaded or nonsensical input', () => {
    expect(epleyE1rm(null, 5)).toBeNull();
    expect(epleyE1rm(100, null)).toBeNull();
    expect(epleyE1rm(0, 5)).toBeNull(); // bodyweight work has no kg 1RM
    expect(epleyE1rm(-10, 5)).toBeNull();
    expect(epleyE1rm(100, 0)).toBeNull();
    expect(epleyE1rm(Number.NaN, 5)).toBeNull();
    expect(epleyE1rm(100, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('is monotonic in weight and in reps', () => {
    for (let reps = 1; reps <= EPLEY_MAX_REPS; reps++) {
      expect(epleyE1rm(101, reps)!).toBeGreaterThan(epleyE1rm(100, reps)!);
    }
    for (let reps = 2; reps <= EPLEY_MAX_REPS; reps++) {
      expect(epleyE1rm(100, reps)!).toBeGreaterThan(epleyE1rm(100, reps - 1)!);
    }
  });

  it('never estimates below the weight actually lifted', () => {
    for (let reps = 1; reps <= EPLEY_MAX_REPS; reps++) {
      expect(epleyE1rm(100, reps)!).toBeGreaterThanOrEqual(100);
    }
  });
});

describe('setE1rm', () => {
  it('ignores warmups', () => {
    // WHY: a heavy-looking warmup single would otherwise register as a PR.
    expect(setE1rm(set({ isWarmup: true, weightKg: 200, reps: 1 }))).toBeNull();
    expect(setE1rm(set())).toBeCloseTo(116.6667, 4);
  });
});

describe('bestE1rm', () => {
  it('picks the highest qualifying estimate', () => {
    const best = bestE1rm([
      set({ weightKg: 100, reps: 5 }), // 116.67
      set({ weightKg: 120, reps: 3 }), // 132.00
      set({ weightKg: 140, reps: 1 }), // 140.00
    ]);
    expect(best).toBeCloseTo(140, 6);
  });

  it('skips sets that do not qualify', () => {
    expect(
      bestE1rm([set({ isWarmup: true, weightKg: 300 }), set({ weightKg: 50, reps: 40 })])
    ).toBeNull();
  });

  it('returns null for an empty history', () => {
    expect(bestE1rm([])).toBeNull();
  });
});
