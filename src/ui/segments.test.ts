import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_SEGMENTS, segmentFills } from './segments';

describe('segmentFills', () => {
  it('fills whole segments for a challenge, one per unit of its target', () => {
    expect(segmentFills(2, 3, 3)).toEqual([1, 1, 0]);
    expect(segmentFills(3, 3, 3)).toEqual([1, 1, 1]);
  });

  it('leaves a partial segment for the weekly meter', () => {
    // 210 of 500 over ten segments is 4.2: four full and a fifth a fifth full.
    const fills = segmentFills(210, 500, 10);
    expect(fills.slice(0, 4)).toEqual([1, 1, 1, 1]);
    expect(fills[4]).toBeCloseTo(0.2);
    expect(fills.slice(5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('never fills past the last segment, or below the first', () => {
    expect(segmentFills(900, 500, 10)).toEqual(Array(10).fill(1));
    expect(segmentFills(-5, 500, 10)).toEqual(Array(10).fill(0));
  });

  it('draws nothing it was not given a total for', () => {
    expect(segmentFills(3, 0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(segmentFills(Number.NaN, 5, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(segmentFills(3, 5, 0)).toEqual([]);
    expect(segmentFills(3, 5, 2.5)).toEqual([]);
  });

  it('caps the segment count', () => {
    expect(segmentFills(1, 40, 40)).toHaveLength(MAX_SEGMENTS);
  });

  it('adds up to the share of the total, and never rises after it falls', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 1, max: MAX_SEGMENTS }),
        (value, total, count) => {
          const fills = segmentFills(value, total, count);
          const sum = fills.reduce((a, b) => a + b, 0);
          expect(sum).toBeCloseTo(Math.min(value / total, 1) * count, 9);
          for (let i = 1; i < fills.length; i++) {
            expect(fills[i]!).toBeLessThanOrEqual(fills[i - 1]!);
          }
        }
      )
    );
  });
});
