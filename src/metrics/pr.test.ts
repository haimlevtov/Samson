import { describe, expect, it } from 'vitest';
import { detectPrs, exerciseBests } from './pr';
import type { SetRecord } from './types';

const set = (over: Partial<SetRecord> = {}): SetRecord => ({
  exerciseId: 'squat',
  weightKg: 100,
  reps: 5,
  isWarmup: false,
  localDate: '2026-08-24',
  ...over,
});

describe('exerciseBests', () => {
  it('tracks best e1RM, best absolute weight, and best weight per rep count', () => {
    const bests = exerciseBests([
      set({ localDate: '2026-08-01', weightKg: 100, reps: 5 }),
      set({ localDate: '2026-08-08', weightKg: 120, reps: 3 }),
      set({ localDate: '2026-08-15', weightKg: 105, reps: 5 }),
    ]);

    const squat = bests.get('squat')!;
    expect(squat.bestE1rm).toBeCloseTo(132, 6); // 120 × (1 + 3/30)
    expect(squat.bestE1rmDate).toBe('2026-08-08');
    expect(squat.bestWeightKg).toBe(120);
    expect(squat.bestWeightByReps.get(5)).toBe(105);
    expect(squat.bestWeightByReps.get(3)).toBe(120);
  });

  it('keeps exercises separate', () => {
    const bests = exerciseBests([
      set({ exerciseId: 'squat', weightKg: 140 }),
      set({ exerciseId: 'bench', weightKg: 90 }),
    ]);
    expect(bests.get('squat')!.bestWeightKg).toBe(140);
    expect(bests.get('bench')!.bestWeightKg).toBe(90);
  });

  it('ignores warmups and unloaded sets', () => {
    const bests = exerciseBests([
      set({ isWarmup: true, weightKg: 300 }),
      set({ weightKg: 0, reps: 20 }),
      set({ weightKg: 100, reps: 5 }),
    ]);
    expect(bests.get('squat')!.bestWeightKg).toBe(100);
  });

  it('records the weight but no e1RM for a set beyond the Epley range', () => {
    // The lift happened, so it is a weight record; the estimate is not credible.
    const squat = exerciseBests([set({ weightKg: 60, reps: 20 })]).get('squat')!;
    expect(squat.bestWeightKg).toBe(60);
    expect(squat.bestE1rm).toBeNull();
  });

  it('is empty when nothing qualifies', () => {
    expect(exerciseBests([]).size).toBe(0);
    expect(exerciseBests([set({ isWarmup: true })]).size).toBe(0);
  });
});

describe('detectPrs', () => {
  it('fires on the day a record was actually set', () => {
    const events = detectPrs([
      set({ localDate: '2026-08-15', weightKg: 105, reps: 5 }),
      set({ localDate: '2026-08-01', weightKg: 100, reps: 5 }),
    ]);
    // Input order must not matter: the replay sorts by date.
    const first = events.filter((e) => e.localDate === '2026-08-01');
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((e) => e.previous === null)).toBe(true);
  });

  it('does not fire again for a lighter or equal set', () => {
    const events = detectPrs([
      set({ localDate: '2026-08-01', weightKg: 100, reps: 5 }),
      set({ localDate: '2026-08-08', weightKg: 100, reps: 5 }),
      set({ localDate: '2026-08-15', weightKg: 95, reps: 5 }),
    ]);
    expect(events.filter((e) => e.localDate !== '2026-08-01')).toEqual([]);
  });

  it('records what the new record beat', () => {
    const events = detectPrs([
      set({ localDate: '2026-08-01', weightKg: 100, reps: 5 }),
      set({ localDate: '2026-08-08', weightKg: 110, reps: 5 }),
    ]);
    const weightPr = events.find((e) => e.kind === 'weight' && e.localDate === '2026-08-08')!;
    expect(weightPr.value).toBe(110);
    expect(weightPr.previous).toBe(100);
  });

  it('separates an e1RM record from a raw weight record', () => {
    // A heavier single can beat the weight record while a rep set still holds
    // the better estimate.
    const events = detectPrs([
      set({ localDate: '2026-08-01', weightKg: 100, reps: 5 }), // e1RM 116.67
      set({ localDate: '2026-08-08', weightKg: 110, reps: 1 }), // e1RM 110.00
    ]);
    const second = events.filter((e) => e.localDate === '2026-08-08');
    expect(second.map((e) => e.kind)).toEqual(['weight']);
  });

  it('emits a rep-count record when an established rep bracket improves', () => {
    const events = detectPrs([
      set({ localDate: '2026-08-01', weightKg: 100, reps: 5 }),
      set({ localDate: '2026-08-08', weightKg: 120, reps: 3 }),
      set({ localDate: '2026-08-15', weightKg: 105, reps: 5 }),
    ]);
    const repPr = events.filter((e) => e.kind === 'reps-at-weight');
    expect(repPr).toHaveLength(1);
    expect(repPr[0]!.localDate).toBe('2026-08-15');
    expect(repPr[0]!.previous).toBe(100);
  });

  it('never emits a record for a warmup', () => {
    expect(detectPrs([set({ isWarmup: true, weightKg: 500, reps: 1 })])).toEqual([]);
  });

  it('emits events in date order', () => {
    const events = detectPrs([
      set({ localDate: '2026-08-15', weightKg: 120 }),
      set({ localDate: '2026-08-01', weightKg: 100 }),
      set({ localDate: '2026-08-08', weightKg: 110 }),
    ]);
    const dates = events.map((e) => e.localDate);
    expect([...dates].sort()).toEqual(dates);
  });

  it('agrees with exerciseBests on the final record', () => {
    const sets = [
      set({ localDate: '2026-08-01', weightKg: 100, reps: 5 }),
      set({ localDate: '2026-08-08', weightKg: 120, reps: 3 }),
      set({ localDate: '2026-08-15', weightKg: 105, reps: 5 }),
    ];
    const lastWeightPr = [...detectPrs(sets)].reverse().find((e) => e.kind === 'weight')!;
    expect(lastWeightPr.value).toBe(exerciseBests(sets).get('squat')!.bestWeightKg);
  });
});
