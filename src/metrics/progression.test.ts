/**
 * Tests for `src/metrics/progression.ts`, from ADR 0014.
 *
 * The cases that matter are the ones where a chart quietly lies: a warm-up
 * dragging the axis down, two sessions in one day putting two points on one x,
 * a plateau dividing by zero, and a tie flipping the label between renders.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_PLOTTED_SESSIONS,
  exerciseProgression,
  progressionChange,
  progressionRange,
  progressionView,
  type ProgressionPoint,
} from './progression';
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

describe('progressionChange', () => {
  const at = (weightKg: number, localDate: string) => ({ localDate, weightKg, reps: 5 });

  it('measures from the first session to the last', () => {
    expect(
      progressionChange([at(100, '2026-09-01'), at(110, '2026-09-08'), at(122.5, '2026-09-15')])
    ).toBe(22.5);
  });

  it('reports a decline as a negative number rather than hiding it', () => {
    expect(progressionChange([at(100, '2026-09-01'), at(90, '2026-09-08')])).toBe(-10);
  });

  it('reports a plateau as zero, not as nothing', () => {
    // Zero and null are different answers: one says "no change", the other
    // says "not enough history to have changed".
    expect(progressionChange([at(100, '2026-09-01'), at(100, '2026-09-08')])).toBe(0);
  });

  it('has no answer for a single session', () => {
    expect(progressionChange([at(100, '2026-09-01')])).toBeNull();
    expect(progressionChange([])).toBeNull();
  });

  it('rounds plate maths rather than printing its float', () => {
    // 122.5 - 100 is 22.499999999999996 in binary floating point.
    const change = progressionChange([at(100, '2026-09-01'), at(122.5, '2026-09-08')]);
    expect(change).toBe(22.5);
    expect(String(change)).not.toContain('99999');
  });
});

describe('progressionView', () => {
  const many = (n: number): ProgressionPoint[] =>
    Array.from({ length: n }, (_, i) => ({
      localDate: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      weightKg: 100 + i,
      reps: 5,
    }));

  it('shows everything when the history is short', () => {
    const view = progressionView(many(12));
    expect(view.points).toHaveLength(12);
    expect(view.hidden).toBe(0);
  });

  it('keeps the most RECENT sessions when there are too many to draw', () => {
    const view = progressionView(many(MAX_PLOTTED_SESSIONS + 20));

    expect(view.points).toHaveLength(MAX_PLOTTED_SESSIONS);
    expect(view.hidden).toBe(20);
    // Recency is the point: a progression chart that dropped this month to keep
    // last year would answer the opposite of the question being asked.
    expect(view.points.at(-1)?.weightKg).toBe(100 + MAX_PLOTTED_SESSIONS + 19);
  });

  /*
   * The truncation case. A set-row cap can cut mid-session, so the oldest day
   * that survived may be missing its heavier sets — plotting it would draw a
   * dip the user never trained.
   */
  it('drops the oldest day when the read was truncated', () => {
    const points = many(10);
    const view = progressionView(points, true);

    expect(view.points).toHaveLength(9);
    expect(view.points[0]?.localDate).toBe(points[1]?.localDate);
    expect(view.hidden).toBe(1);
  });

  it('does not drop anything when the read was complete', () => {
    expect(progressionView(many(10), false).points).toHaveLength(10);
  });

  it('survives an empty history without dropping a point that is not there', () => {
    expect(progressionView([], true)).toEqual({ points: [], hidden: 0 });
  });

  it('does not mutate the array it was given', () => {
    const points = many(5);
    const copy = structuredClone(points);
    progressionView(points, true);
    expect(points).toEqual(copy);
  });
});
