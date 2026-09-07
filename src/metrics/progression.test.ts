/**
 * Tests for `src/metrics/progression.ts`, from ADR 0014.
 *
 * The cases that matter are the ones where a chart quietly lies: a warm-up
 * dragging the axis down, two sessions in one day putting two points on one x,
 * a plateau dividing by zero, and a tie flipping the label between renders.
 */
import { describe, expect, it } from 'vitest';
import { exerciseProgression, progressionRange } from './progression';
import type { SetRecord } from './types';

const SQUAT = 'squat-id';
const BENCH = 'bench-id';

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

describe('exerciseProgression', () => {
  it('returns one point per day, oldest first', () => {
    const points = exerciseProgression(
      [
        set({ localDate: '2026-09-03', weightKg: 105 }),
        set({ localDate: '2026-09-01', weightKg: 100 }),
        set({ localDate: '2026-09-02', weightKg: 102.5 }),
      ],
      SQUAT
    );

    expect(points.map((p) => p.localDate)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(points.map((p) => p.weightKg)).toEqual([100, 102.5, 105]);
  });

  it('keeps the heaviest working set of the day', () => {
    const points = exerciseProgression(
      [set({ weightKg: 80 }), set({ weightKg: 100 }), set({ weightKg: 90 })],
      SQUAT
    );

    expect(points).toHaveLength(1);
    expect(points[0]?.weightKg).toBe(100);
  });

  /*
   * Two workouts in one afternoon are two rows and one training day. `workouts`
   * has no unique constraint on (user_id, local_date), so without collapsing by
   * date the chart puts two points on the same x position.
   */
  it('collapses two sessions on the same day into one point', () => {
    const points = exerciseProgression(
      [
        set({ localDate: '2026-09-01', weightKg: 90 }),
        set({ localDate: '2026-09-01', weightKg: 95 }),
      ],
      SQUAT
    );

    expect(points).toHaveLength(1);
    expect(points[0]?.weightKg).toBe(95);
  });

  it('breaks a tie on weight by taking the most reps', () => {
    // 80x8 is a better day than 80x3, and the label under a point must not flip
    // between renders because the array arrived in a different order.
    const ascending = exerciseProgression(
      [set({ weightKg: 80, reps: 3 }), set({ weightKg: 80, reps: 8 })],
      SQUAT
    );
    const descending = exerciseProgression(
      [set({ weightKg: 80, reps: 8 }), set({ weightKg: 80, reps: 3 })],
      SQUAT
    );

    expect(ascending[0]?.reps).toBe(8);
    expect(descending[0]?.reps).toBe(8);
  });

  it('ignores warm-ups, which would flatten the axis', () => {
    const points = exerciseProgression(
      [set({ weightKg: 20, isWarmup: true }), set({ weightKg: 100 })],
      SQUAT
    );

    expect(points).toHaveLength(1);
    expect(points[0]?.weightKg).toBe(100);
  });

  it('ignores a day that was only warm-ups rather than plotting a low point', () => {
    const points = exerciseProgression(
      [
        set({ localDate: '2026-09-01', weightKg: 100 }),
        set({ localDate: '2026-09-02', weightKg: 20, isWarmup: true }),
      ],
      SQUAT
    );

    expect(points.map((p) => p.localDate)).toEqual(['2026-09-01']);
  });

  it('plots nothing for a bodyweight movement', () => {
    // weightKg is null by design for unloaded work; a zero would be a claim.
    expect(exerciseProgression([set({ weightKg: null })], SQUAT)).toEqual([]);
    expect(exerciseProgression([set({ weightKg: 0 })], SQUAT)).toEqual([]);
  });

  it('reads only the exercise it was asked about', () => {
    const points = exerciseProgression(
      [set({ exerciseId: BENCH, weightKg: 200 }), set({ weightKg: 100 })],
      SQUAT
    );

    expect(points).toHaveLength(1);
    expect(points[0]?.weightKg).toBe(100);
  });

  it('returns nothing for a lift with no history', () => {
    expect(exerciseProgression([], SQUAT)).toEqual([]);
    expect(exerciseProgression([set({ exerciseId: BENCH })], SQUAT)).toEqual([]);
  });

  it('keeps a null rep count rather than inventing one', () => {
    expect(exerciseProgression([set({ reps: null })], SQUAT)[0]?.reps).toBeNull();
  });
});

describe('progressionRange', () => {
  it('spans the data when it varies', () => {
    expect(
      progressionRange([
        { localDate: '2026-09-01', weightKg: 80, reps: 5 },
        { localDate: '2026-09-02', weightKg: 100, reps: 5 },
      ])
    ).toEqual({ min: 80, max: 100 });
  });

  /*
   * The plateau. Six sessions at the same weight give min === max, and a chart
   * drawn on a zero-height axis either divides by zero or stacks every point.
   */
  it('pads a flat history instead of collapsing to a zero-height axis', () => {
    const range = progressionRange([
      { localDate: '2026-09-01', weightKg: 100, reps: 5 },
      { localDate: '2026-09-02', weightKg: 100, reps: 5 },
    ]);

    expect(range.max).toBeGreaterThan(range.min);
    // The flat line sits down the middle, which is the honest picture.
    expect((100 - range.min) / (range.max - range.min)).toBeCloseTo(0.5);
  });

  it('never pads below zero, however light the lift', () => {
    const range = progressionRange([{ localDate: '2026-09-01', weightKg: 2, reps: 10 }]);
    expect(range.min).toBeGreaterThanOrEqual(0);
    expect(range.max).toBeGreaterThan(range.min);
  });

  it('gives an empty history a usable, non-degenerate range', () => {
    const range = progressionRange([]);
    expect(range.max).toBeGreaterThan(range.min);
  });

  /*
   * Deliberately NOT anchored at zero — ADR 0014. This is a change chart. On a
   * 100 kg squat a zero floor compresses a 10 kg gain into a tenth of the
   * height, which hides exactly what the feature exists to show.
   */
  it('does not anchor the axis at zero', () => {
    const range = progressionRange([
      { localDate: '2026-09-01', weightKg: 100, reps: 5 },
      { localDate: '2026-09-02', weightKg: 110, reps: 5 },
    ]);

    expect(range.min).toBe(100);
  });
});
