import { describe, expect, it } from 'vitest';
import {
  orderBySession,
  pickPreviousSets,
  type LoggedSet,
  type PriorSetRow,
} from '../../src/db/training';

/**
 * The two rules the session grid reads before the user chooses a weight —
 * ADR 0011. Both are pure; neither needs a database, which is the point.
 */

function prior(overrides: Partial<PriorSetRow> = {}): PriorSetRow {
  return {
    exerciseId: 'squat',
    workoutId: 'w1',
    localDate: '2026-09-01',
    setIndex: 0,
    weightKg: 100,
    reps: 5,
    isWarmup: false,
    ...overrides,
  };
}

function logged(overrides: Partial<LoggedSet> = {}): LoggedSet {
  return {
    id: 's1',
    exerciseId: 'squat',
    exerciseName: 'Squat',
    setIndex: 0,
    weightKg: 100,
    reps: 5,
    rpe: null,
    restSeconds: 120,
    isWarmup: false,
    completedAt: '2026-09-05T10:00:00Z',
    ...overrides,
  };
}

describe('pickPreviousSets', () => {
  it('takes the most recent session, not a blend of several', () => {
    const previous = pickPreviousSets([
      prior({ workoutId: 'old', localDate: '2026-08-01', weightKg: 80 }),
      prior({ workoutId: 'old', localDate: '2026-08-01', setIndex: 1, weightKg: 80 }),
      prior({ workoutId: 'new', localDate: '2026-08-29', weightKg: 100 }),
    ]);

    // One set in the last session means one previous set. Topping the list up
    // from a session three weeks earlier would read as "you did 80 last time"
    // on the row under one that says 100.
    expect(previous.squat?.working).toEqual([{ weightKg: 100, reps: 5 }]);
  });

  it('keeps each exercise on its own timeline', () => {
    const previous = pickPreviousSets([
      prior({ exerciseId: 'squat', workoutId: 'a', localDate: '2026-08-20', weightKg: 100 }),
      prior({ exerciseId: 'bench', workoutId: 'b', localDate: '2026-08-27', weightKg: 60 }),
    ]);

    expect(previous.squat?.working[0]?.weightKg).toBe(100);
    expect(previous.bench?.working[0]?.weightKg).toBe(60);
  });

  it('lines warm-ups up with warm-ups, not with set 1', () => {
    const previous = pickPreviousSets([
      prior({ setIndex: 2, weightKg: 102.5 }),
      prior({ setIndex: 0, weightKg: 60, isWarmup: true }),
      prior({ setIndex: 1, weightKg: 100 }),
    ]);

    // set_index 0 was a warm-up. Offering 60 kg against today's first
    // working set is how a PREVIOUS column tells a lie with true numbers.
    expect(previous.squat?.warmup.map((s) => s.weightKg)).toEqual([60]);
    expect(previous.squat?.working.map((s) => s.weightKg)).toEqual([100, 102.5]);
  });

  it('breaks a same-day tie the same way every time', () => {
    const rows = [
      prior({ workoutId: 'aaa', weightKg: 90 }),
      prior({ workoutId: 'bbb', weightKg: 95 }),
    ];

    // The value matters less than its stability: a PREVIOUS column that
    // disagreed with itself between renders would be worse than none.
    expect(pickPreviousSets(rows)).toEqual(pickPreviousSets([...rows].reverse()));
  });

  it('has nothing to say about a lift with no history', () => {
    expect(pickPreviousSets([])).toEqual({});
  });

  it('carries bodyweight sets through as bodyweight', () => {
    const previous = pickPreviousSets([prior({ exerciseId: 'pullup', weightKg: null, reps: 8 })]);
    expect(previous.pullup?.working).toEqual([{ weightKg: null, reps: 8 }]);
  });
});

describe('orderBySession', () => {
  it('groups by exercise in the order the session ran', () => {
    const ordered = orderBySession([
      logged({ id: 'b1', exerciseId: 'bench', exerciseName: 'Bench', completedAt: '10:30' }),
      logged({ id: 's1', exerciseId: 'squat', exerciseName: 'Squat', completedAt: '10:00' }),
      logged({
        id: 's2',
        exerciseId: 'squat',
        exerciseName: 'Squat',
        setIndex: 1,
        completedAt: '10:10',
      }),
    ]);

    // Alphabetically Bench comes first. It was not first.
    expect(ordered.map((s) => s.id)).toEqual(['s1', 's2', 'b1']);
  });

  it('keeps sets of one exercise in index order regardless of timestamps', () => {
    const ordered = orderBySession([
      logged({ id: 's2', setIndex: 1, completedAt: '10:10' }),
      logged({ id: 's1', setIndex: 0, completedAt: '10:20' }),
    ]);

    expect(ordered.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('falls back to the name when nothing is timestamped', () => {
    const ordered = orderBySession([
      logged({ id: 'z', exerciseId: 'z', exerciseName: 'Zercher', completedAt: null }),
      logged({ id: 'a', exerciseId: 'a', exerciseName: 'Adductor', completedAt: null }),
    ]);

    expect(ordered.map((s) => s.id)).toEqual(['a', 'z']);
  });
});
