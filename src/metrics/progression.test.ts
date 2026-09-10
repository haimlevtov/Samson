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
  progressionLabels,
  progressionRange,
  progressionTicks,
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

/**
 * The three figures printed over the line — ADR 0014, amended 2026-09-10.
 *
 * The chart is drawn in a browser and these decide what it says, so this is
 * where a label that crowds another can fail without one.
 */
describe('progressionLabels', () => {
  /** `n` sessions, all at 100 kg unless `peaks` names a heavier one. */
  const run = (n: number, peaks: Record<number, number> = {}): ProgressionPoint[] =>
    Array.from({ length: n }, (_, i) => ({
      localDate: `2026-01-${String(i + 1).padStart(2, '0')}`,
      weightKg: peaks[i] ?? 100,
      reps: 5,
    }));

  it('labels the two ends, which is what the headline figure compares', () => {
    const labels = progressionLabels(run(9));

    expect(labels.map((l) => l.kind)).toEqual(['first', 'last']);
    expect(labels.map((l) => l.index)).toEqual([0, 8]);
  });

  it('adds the heaviest when it is neither end', () => {
    const labels = progressionLabels(run(9, { 4: 120 }));

    expect(labels.map((l) => l.kind)).toEqual(['first', 'last', 'heaviest']);
    expect(labels[2]?.index).toBe(4);
    expect(labels[2]?.point.weightKg).toBe(120);
  });

  it('does not label the heaviest twice when it is already an end', () => {
    /*
     * A run that peaks on its last session is the ordinary shape of progress,
     * so this is the common case rather than an edge one. It falls out of
     * MIN_LABEL_GAP rather than needing its own branch — an end point sits at 0
     * or 1 of the axis, outside any positive gap.
     */
    expect(progressionLabels(run(9, { 8: 120 })).map((l) => l.kind)).toEqual(['first', 'last']);
    expect(progressionLabels(run(9, { 0: 120 })).map((l) => l.kind)).toEqual(['first', 'last']);
  });

  it('drops a heaviest label that would crowd an end', () => {
    /*
     * 20 sessions, peak on the second: 1/19 of the axis from the left. The
     * layout puts it on its own row so it would not overlap — but a figure
     * printed a few pixels from the first point's is unreadable anyway, and
     * MIN_LABEL_GAP is what keeps it off.
     */
    expect(progressionLabels(run(20, { 1: 120 })).map((l) => l.kind)).toEqual(['first', 'last']);
    expect(progressionLabels(run(20, { 18: 120 })).map((l) => l.kind)).toEqual(['first', 'last']);

    // And it comes back once there is room, on the same history shape.
    expect(progressionLabels(run(20, { 10: 120 })).map((l) => l.kind)).toContain('heaviest');
  });

  it('keeps the earliest of tied heaviest sessions', () => {
    /*
     * AI-NOTE: the alternative flips the label to a later date the day somebody
     * repeats a best, which reads as the peak moving backwards along a chart
     * that did not change shape.
     */
    expect(progressionLabels(run(11, { 3: 120, 7: 120 }))[2]?.index).toBe(3);
  });

  it('labels nothing when there is no line to label', () => {
    // One session renders as a sentence, not a chart.
    expect(progressionLabels(run(1))).toEqual([]);
    expect(progressionLabels([])).toEqual([]);
  });

  it('labels both ends of a two-session chart and nothing else', () => {
    const labels = progressionLabels(run(2, { 1: 120 }));

    expect(labels.map((l) => l.index)).toEqual([0, 1]);
  });

  it('carries the point itself, so the caller does not index back into the array', () => {
    // The caller positions from `index` and prints from `point`; if they could
    // disagree the label would name one session and sit over another.
    const points = run(9, { 4: 120 });

    for (const entry of progressionLabels(points)) {
      expect(entry.point).toBe(points[entry.index]);
    }
  });
});

describe('progressionTicks', () => {
  const at = (weightKg: number, localDate: string) => ({ localDate, weightKg, reps: 5 });

  it('prints nothing when the labels already carry both extremes', () => {
    /*
     * The commonest history there is: it only rises, so the first and last
     * points ARE the minimum and the maximum and their labels print both, with
     * the reps attached. An axis repeating them is two more figures saying what
     * the chart just said.
     */
    const rising = [at(100, '2026-09-01'), at(110, '2026-09-08'), at(120, '2026-09-15')];

    expect(progressionTicks(rising)).toEqual([]);
  });

  it('prints the trough of a deload, which no label reaches', () => {
    // THE case ticks exist for. The 60 kg week is the lowest point on the
    // chart and it is neither end nor the peak, so nothing else names it.
    const deload = [
      at(100, '2026-09-01'),
      at(110, '2026-09-08'),
      at(130, '2026-09-15'),
      at(60, '2026-09-22'),
      at(115, '2026-09-29'),
    ];

    expect(progressionTicks(deload)).toEqual([60]);
  });

  it('prints a peak whose label was dropped for crowding another', () => {
    /*
     * The two rules meeting. `progressionLabels` drops a heaviest label that
     * would land on the last one — and then the highest weight on the chart has
     * nothing naming it, which is exactly the gap a tick fills.
     */
    const nearTie = [
      ...Array.from({ length: 15 }, (_, i) =>
        at(100 + i * 3, `2026-01-${String(i + 1).padStart(2, '0')}`)
      ),
      at(190, '2026-02-01'),
      at(180, '2026-02-02'),
      at(183, '2026-02-03'),
      at(186, '2026-02-04'),
      at(189, '2026-02-05'),
    ];

    expect(progressionLabels(nearTie).map((l) => l.kind)).not.toContain('heaviest');
    expect(progressionTicks(nearTie)).toEqual([190]);
  });

  it('never prints a weight that was not lifted', () => {
    /*
     * INVARIANT, and the reason this function exists rather than reading
     * `progressionRange`: that one PADS a flat history so the line has
     * somewhere to sit, and printing the padded bound would put 110 kg on the
     * axis of somebody who has only ever lifted 100.
     */
    const flat = [at(100, '2026-09-01'), at(100, '2026-09-08'), at(100, '2026-09-15')];
    expect(progressionRange(flat).max).toBeGreaterThan(100);

    const cases = [
      flat,
      [at(100, '2026-09-01'), at(130, '2026-09-08'), at(60, '2026-09-15'), at(115, '2026-09-22')],
      [at(60, '2026-09-01'), at(60, '2026-09-08')],
    ];

    for (const points of cases) {
      const lifted = new Set(points.map((p) => p.weightKg));
      for (const tick of progressionTicks(points)) expect(lifted).toContain(tick);
    }
  });

  it('has nothing to say about no sessions', () => {
    expect(progressionTicks([])).toEqual([]);
  });
});

describe('progressionLabels — the side the line is not on', () => {
  const at = (weightKg: number, localDate: string) => ({ localDate, weightKg, reps: 5 });
  const sideOf = (points: ProgressionPoint[], kind: string) =>
    progressionLabels(points).find((l) => l.kind === kind)?.side;

  const rising = [at(100, '2026-09-01'), at(110, '2026-09-08'), at(120, '2026-09-15')];
  const falling = [at(120, '2026-09-01'), at(110, '2026-09-08'), at(100, '2026-09-15')];

  it('puts both labels clear of a rising line', () => {
    // Up and to the right from the first point, so below it is free; arriving
    // from below-left at the last, so above it is free.
    expect(sideOf(rising, 'first')).toBe('below');
    expect(sideOf(rising, 'last')).toBe('above');
  });

  it('puts both labels clear of a falling line', () => {
    expect(sideOf(falling, 'first')).toBe('above');
    expect(sideOf(falling, 'last')).toBe('below');
  });

  it('reads the segment at each end, not the overall direction', () => {
    /*
     * The case a "did it go up overall" test would pass and a chart would fail:
     * a history that ends lower than it started while its LAST segment rises.
     * The last label has to clear that segment, not the whole line.
     */
    const dip = [at(120, '2026-09-01'), at(80, '2026-09-08'), at(100, '2026-09-15')];

    expect(sideOf(dip, 'first')).toBe('above');
    expect(sideOf(dip, 'last')).toBe('above');
  });

  it('keeps the two ends on opposite sides when a segment is flat', () => {
    // Neither side is clearer of a horizontal segment, so the tie-break exists
    // to stop both ends stacking onto the same row.
    const flat = [at(100, '2026-09-01'), at(100, '2026-09-08'), at(100, '2026-09-15')];

    expect(sideOf(flat, 'first')).toBe('below');
    expect(sideOf(flat, 'last')).toBe('above');
  });

  it('always puts the heaviest above, because nothing is drawn over it', () => {
    const peak = [
      at(100, '2026-09-01'),
      at(110, '2026-09-08'),
      at(160, '2026-09-15'),
      at(115, '2026-09-22'),
      at(120, '2026-09-29'),
    ];

    expect(sideOf(peak, 'heaviest')).toBe('above');
  });
});

/**
 * The heaviest label is dropped when it would land on another one.
 *
 * FOUND IN REVIEW, and the reasoning it corrects is worth keeping: the first
 * version claimed that printing the heaviest above its point and the ends below
 * theirs guaranteed separation. It does not. An end label is only below when
 * the line FALLS into it, so on a rising history the last label is above its
 * point too — and a peak a kilogram higher than the final session, near the end
 * of the axis, puts the two on the same line of text.
 */
describe('progressionLabels — the heaviest label gives way', () => {
  /** 20 sessions rising to `peak` at index 15, then a dip and a rise to `end`. */
  const shape = (peak: number, end: number, tail: number[]): ProgressionPoint[] => {
    const weights = [...Array.from({ length: 15 }, (_, i) => 100 + i * 3), peak, ...tail, end];
    return weights.map((weightKg, i) => ({
      localDate: `2026-01-${String(i + 1).padStart(2, '0')}`,
      weightKg,
      reps: 5,
    }));
  };

  const kinds = (points: ProgressionPoint[]) => progressionLabels(points).map((l) => l.kind);

  it('drops it when the peak is barely above a rising last session', () => {
    // Peak 190 at 15/19 of the axis; the run ends at 189, one kilogram down and
    // rising — so both labels want the same row, a tenth of the axis apart.
    expect(kinds(shape(190, 189, [180, 183, 186]))).toEqual(['first', 'last']);
  });

  it('keeps it when the same peak is well clear of the last session', () => {
    // The only thing that changed is how far the run fell away from its peak.
    expect(kinds(shape(190, 120, [110, 114, 117]))).toContain('heaviest');
  });

  it('keeps it when the line falls into the end, which puts that label below', () => {
    // Same near-tie in weight, opposite direction into the last point, so the
    // two labels are on opposite sides of their points and cannot meet.
    expect(kinds(shape(190, 186, [180, 188, 189]))).toContain('heaviest');
  });

  it('holds the axis gap to what keeps a centred label inside the plot', () => {
    /*
     * The boundary MIN_LABEL_GAP actually names. A label centred on its point
     * needs half its own width of axis either side, and nothing else in the
     * suite pinned the constant anywhere near its value — it could have been
     * anything from 0.06 to 0.47 and stayed green.
     */
    const run = (n: number, peakAt: number): ProgressionPoint[] =>
      Array.from({ length: n }, (_, i) => ({
        localDate: `2026-02-${String(i + 1).padStart(2, '0')}`,
        weightKg: i === peakAt ? 200 : 100 + i,
        reps: 5,
      }));

    // 1/11 = 0.09 of the axis: a centred label would hang off the left edge.
    expect(kinds(run(12, 1))).toEqual(['first', 'last']);
    // 2/11 = 0.18: the first position that clears it.
    expect(kinds(run(12, 2))).toContain('heaviest');
    // And the mirror at the other end: 10/11 = 0.91 out, 9/11 = 0.82 in.
    expect(kinds(run(12, 10))).toEqual(['first', 'last']);
    expect(kinds(run(12, 9))).toContain('heaviest');
  });
});
