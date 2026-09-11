import { describe, expect, it } from 'vitest';
import { eachDay } from './dates';
import {
  DEFAULT_SECONDARY_WEIGHT,
  setTonnage,
  tonnageByDate,
  tonnageByMuscle,
  tonnageByWeek,
  tonnageForWeekOf,
  totalTonnage,
} from './tonnage';
import type { ExerciseMuscles, SetRecord } from './types';

const set = (over: Partial<SetRecord> = {}): SetRecord => ({
  exerciseId: 'squat',
  weightKg: 100,
  reps: 5,
  isWarmup: false,
  localDate: '2026-08-24',
  ...over,
});

const catalogue: ExerciseMuscles[] = [
  { exerciseId: 'squat', primaryMuscle: 'quadriceps', secondaryMuscles: ['glutes', 'hamstrings'] },
  { exerciseId: 'bench', primaryMuscle: 'chest', secondaryMuscles: ['triceps'] },
];

describe('setTonnage', () => {
  it('multiplies load by reps', () => {
    expect(setTonnage(set({ weightKg: 100, reps: 5 }))).toBe(500);
  });

  it('excludes warmups by default and includes them on request', () => {
    const warmup = set({ isWarmup: true });
    expect(setTonnage(warmup)).toBe(0);
    expect(setTonnage(warmup, { includeWarmups: true })).toBe(500);
  });

  it('counts external load only, so bodyweight work is zero', () => {
    // WHY: see tonnage.ts. Imputing bodyweight would rewrite history whenever a
    //      user updates their weight.
    expect(setTonnage(set({ exerciseId: 'pullup', weightKg: 0, reps: 10 }))).toBe(0);
    expect(setTonnage(set({ exerciseId: 'pullup', weightKg: null, reps: 10 }))).toBe(0);
  });

  it('is zero for missing, negative, or non-finite values', () => {
    expect(setTonnage(set({ reps: null }))).toBe(0);
    expect(setTonnage(set({ reps: 0 }))).toBe(0);
    expect(setTonnage(set({ weightKg: -5 }))).toBe(0);
    expect(setTonnage(set({ weightKg: Number.NaN }))).toBe(0);
  });

  it('is monotonic in reps', () => {
    for (let reps = 1; reps < 20; reps++) {
      expect(setTonnage(set({ reps: reps + 1 }))).toBeGreaterThan(setTonnage(set({ reps })));
    }
  });
});

describe('totalTonnage', () => {
  it('sums a session', () => {
    expect(
      totalTonnage([
        set({ weightKg: 100, reps: 5 }),
        set({ weightKg: 60, reps: 8 }),
        set({ weightKg: 40, reps: 12, isWarmup: true }),
      ])
    ).toBe(500 + 480);
  });

  it('is zero for an empty history', () => {
    expect(totalTonnage([])).toBe(0);
  });
});

describe('tonnageByDate', () => {
  it('groups by local date, ascending, omitting empty days', () => {
    const byDate = tonnageByDate([
      set({ localDate: '2026-08-25', weightKg: 50, reps: 10 }),
      set({ localDate: '2026-08-24', weightKg: 100, reps: 5 }),
      set({ localDate: '2026-08-24', weightKg: 100, reps: 5 }),
      set({ localDate: '2026-08-26', weightKg: 0, reps: 20 }), // no external load
    ]);
    expect([...byDate.entries()]).toEqual([
      ['2026-08-24', 1000],
      ['2026-08-25', 500],
    ]);
  });
});

describe('tonnageByWeek', () => {
  it('keys on the Monday of each ISO week', () => {
    const byWeek = tonnageByWeek([
      set({ localDate: '2026-08-24', weightKg: 100, reps: 5 }), // Monday
      set({ localDate: '2026-08-30', weightKg: 100, reps: 5 }), // Sunday, same week
      set({ localDate: '2026-08-31', weightKg: 100, reps: 5 }), // next Monday
    ]);
    expect([...byWeek.entries()]).toEqual([
      ['2026-08-24', 1000],
      ['2026-08-31', 500],
    ]);
  });
});

// 2026-09-07 is a Monday; the week before it runs 2026-08-31 to 2026-09-06.
describe('tonnageForWeekOf', () => {
  it('reports the current week as empty when the last sets were in an earlier week', () => {
    const sets = [
      set({ localDate: '2026-08-31', weightKg: 100, reps: 5 }),
      set({ localDate: '2026-09-06', weightKg: 100, reps: 5 }),
    ];

    // The trap, pinned so the reason for this function stays true: the last
    // entry of tonnageByWeek is last week, and the "This week" tile printed it.
    expect([...tonnageByWeek(sets).entries()].at(-1)).toEqual(['2026-08-31', 1000]);

    expect(tonnageForWeekOf(sets, '2026-09-07')).toBe(0); // Monday, nothing yet
    expect(tonnageForWeekOf(sets, '2026-09-11')).toBe(0); // later in the same week
    // The zero is this week's, not an empty history: last week still reads.
    expect(tonnageForWeekOf(sets, '2026-09-06')).toBe(1000);
  });

  it('answers for any day of the week, not only its Monday', () => {
    const sets = [set({ localDate: '2026-09-09', weightKg: 100, reps: 5 })]; // Wednesday
    for (const day of eachDay('2026-09-07', '2026-09-13')) {
      expect(tonnageForWeekOf(sets, day), day).toBe(500);
    }
    expect(tonnageForWeekOf(sets, '2026-09-06')).toBe(0); // the Sunday before
    expect(tonnageForWeekOf(sets, '2026-09-14')).toBe(0); // the Monday after
  });

  it('sums only the week asked about', () => {
    const sets = [
      set({ localDate: '2026-09-04', weightKg: 100, reps: 5 }),
      set({ localDate: '2026-09-08', weightKg: 100, reps: 5 }),
      set({ localDate: '2026-09-10', weightKg: 60, reps: 10 }),
      set({ localDate: '2026-09-15', weightKg: 100, reps: 5 }),
    ];
    expect(tonnageForWeekOf(sets, '2026-09-11')).toBe(1100);
  });

  it('counts a week of only bodyweight or warm-up sets as zero, and honours options', () => {
    const sets = [
      set({ localDate: '2026-09-08', exerciseId: 'pullup', weightKg: 0, reps: 10 }),
      set({ localDate: '2026-09-08', isWarmup: true }),
    ];
    expect(tonnageForWeekOf(sets, '2026-09-11')).toBe(0);
    expect(tonnageForWeekOf(sets, '2026-09-11', { includeWarmups: true })).toBe(500);
  });

  it('is zero for an empty history', () => {
    expect(tonnageForWeekOf([], '2026-09-11')).toBe(0);
  });
});

describe('tonnageByMuscle', () => {
  it('credits the primary in full and secondaries at the configured share', () => {
    const byMuscle = tonnageByMuscle([set({ exerciseId: 'squat' })], catalogue);
    expect(byMuscle.get('quadriceps')).toBe(500);
    expect(byMuscle.get('glutes')).toBe(500 * DEFAULT_SECONDARY_WEIGHT);
    expect(byMuscle.get('hamstrings')).toBe(250);
  });

  it('honours a custom secondary weight, including zero', () => {
    const only = tonnageByMuscle([set({ exerciseId: 'squat' })], catalogue, {
      secondaryWeight: 0,
    });
    expect(only.get('quadriceps')).toBe(500);
    expect(only.has('glutes')).toBe(false);
  });

  it('sums across exercises sharing a muscle', () => {
    const byMuscle = tonnageByMuscle(
      [set({ exerciseId: 'squat' }), set({ exerciseId: 'bench', weightKg: 80, reps: 5 })],
      catalogue
    );
    expect(byMuscle.get('chest')).toBe(400);
    expect(byMuscle.get('triceps')).toBe(200);
    expect(byMuscle.get('quadriceps')).toBe(500);
  });

  it('drops an exercise missing from the catalogue rather than guessing', () => {
    const byMuscle = tonnageByMuscle([set({ exerciseId: 'unknown-lift' })], catalogue);
    expect(byMuscle.size).toBe(0);
  });

  it('attributes at least the total tonnage, since one set trains several muscles', () => {
    const sets = [set({ exerciseId: 'squat' }), set({ exerciseId: 'bench' })];
    const attributed = [...tonnageByMuscle(sets, catalogue).values()].reduce((a, b) => a + b, 0);
    expect(attributed).toBeGreaterThanOrEqual(totalTonnage(sets));
  });
});
