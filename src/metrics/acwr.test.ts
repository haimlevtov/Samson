import { describe, expect, it } from 'vitest';
import { ACWR_HIGH_RISK, DEFAULT_CHRONIC_DAYS, acwr, acwrBand } from './acwr';
import { addDays } from './dates';
import type { SetRecord } from './types';

const AS_OF = '2026-08-24';

/** One set per day for `days` days ending at AS_OF, each worth `tonnage` kg. */
function steady(days: number, tonnage: number, endingAt = AS_OF): SetRecord[] {
  return Array.from({ length: days }, (_, i) => ({
    exerciseId: 'squat',
    weightKg: tonnage / 10,
    reps: 10,
    isWarmup: false,
    localDate: addDays(endingAt, -i),
  }));
}

describe('acwr', () => {
  it('returns null until the chronic window is covered', () => {
    // WHY: with two weeks of history the chronic mean is just the acute one at
    //      longer range, and the ratio hovers near 1.0 regardless of behaviour.
    expect(acwr(steady(14, 1000), AS_OF).ratio).toBeNull();
    expect(acwr(steady(DEFAULT_CHRONIC_DAYS, 1000), AS_OF).ratio).not.toBeNull();
  });

  it('reports the covered days so a caller can explain the null', () => {
    expect(acwr(steady(10, 1000), AS_OF).chronicDaysCovered).toBe(10);
  });

  it('is 1.0 for perfectly steady training', () => {
    const { ratio } = acwr(steady(40, 1000), AS_OF);
    expect(ratio).toBeCloseTo(1, 6);
    expect(acwrBand(ratio)).toBe('sweet-spot');
  });

  it('rises when recent load spikes', () => {
    const base = steady(40, 500);
    const spike = steady(7, 1500); // last week much heavier
    const { ratio } = acwr([...base, ...spike], AS_OF);
    expect(ratio).toBeGreaterThan(1.5);
    expect(acwrBand(ratio)).toBe('danger');
  });

  it('falls during a deload', () => {
    // Four weeks of work, then a quiet week: rest days count as zero-load days,
    // which is the point of using a mean rather than a sum.
    const base = steady(21, 1000, addDays(AS_OF, -7));
    const { ratio } = acwr(base, AS_OF);
    expect(ratio).toBeLessThan(0.8);
    expect(acwrBand(ratio)).toBe('low');
  });

  it('overstates the ratio on a partial window, which is why the guard defaults on', () => {
    // 14 days of identical training: the acute mean is 1000, but the chronic
    // mean divides the same 14 days of load across 28, giving 500. The ratio
    // reads 2.0 — "danger" — for someone training perfectly steadily.
    // This is the number requireFullWindow exists to suppress, not a bug.
    const { ratio, acuteMean, chronicMean } = acwr(steady(14, 1000), AS_OF, {
      requireFullWindow: false,
    });
    expect(acuteMean).toBeCloseTo(1000, 6);
    expect(chronicMean).toBeCloseTo(500, 6);
    expect(ratio).toBeCloseTo(2, 6);
    expect(acwrBand(ratio)).toBe('danger');
  });

  it('returns null when the chronic window holds no load at all', () => {
    // Dividing by a zero chronic mean is undefined, and genuinely has no ratio.
    const stale = steady(30, 1000, addDays(AS_OF, -400));
    expect(acwr(stale, AS_OF, { requireFullWindow: false }).ratio).toBeNull();
  });

  it('honours custom window lengths', () => {
    const result = acwr(steady(20, 1000), AS_OF, { acuteDays: 3, chronicDays: 14 });
    expect(result.ratio).toBeCloseTo(1, 6);
    expect(result.chronicDaysCovered).toBe(14);
  });

  it('excludes warmups from the load it measures', () => {
    const sets = steady(30, 1000).map((s) => ({ ...s, isWarmup: true }));
    expect(acwr(sets, AS_OF).ratio).toBeNull();
  });
});

describe('acwrBand', () => {
  it('names each band at its boundaries', () => {
    expect(acwrBand(null)).toBe('unknown');
    expect(acwrBand(0.79)).toBe('low');
    expect(acwrBand(0.8)).toBe('sweet-spot');
    expect(acwrBand(1.3)).toBe('sweet-spot');
    expect(acwrBand(1.31)).toBe('high');
    expect(acwrBand(ACWR_HIGH_RISK)).toBe('danger');
  });
});
