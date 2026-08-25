import { describe, expect, it } from 'vitest';
import { adherence, currentStreak } from './adherence';
import type { WorkoutRecord, WorkoutStatus } from './types';

const workout = (localDate: string, status: WorkoutStatus): WorkoutRecord => ({
  id: `${localDate}-${status}`,
  localDate,
  status,
});

describe('adherence', () => {
  it('counts completed sessions as kept', () => {
    const result = adherence([
      workout('2026-08-24', 'completed'),
      workout('2026-08-25', 'skipped'),
      workout('2026-08-26', 'completed'),
      workout('2026-08-27', 'completed'),
    ]);
    expect(result.rate).toBe(0.75);
    expect(result.kept).toBe(3);
    expect(result.resolved).toBe(4);
  });

  it('counts a scheduled rest day as kept, not missed', () => {
    // INVARIANT: XP derives from adherence, and rest maintains it — CLAUDE.md #4.
    const result = adherence([workout('2026-08-24', 'completed'), workout('2026-08-25', 'rest')]);
    expect(result.rate).toBe(1);
  });

  it('ignores sessions that have not resolved yet', () => {
    // A planned future session is not evidence of anything.
    const result = adherence([
      workout('2026-08-24', 'completed'),
      workout('2026-08-25', 'planned'),
      workout('2026-08-26', 'in_progress'),
    ]);
    expect(result.rate).toBe(1);
    expect(result.resolved).toBe(1);
  });

  it('returns null rather than zero when nothing has resolved', () => {
    // WHY: "has not started" and "missed everything" are opposite facts, and a
    //      zero would let the coach berate someone on day one.
    expect(adherence([]).rate).toBeNull();
    expect(adherence([workout('2026-08-25', 'planned')]).rate).toBeNull();
  });

  it('reports zero when every resolved session was skipped', () => {
    expect(adherence([workout('2026-08-24', 'skipped')]).rate).toBe(0);
  });

  it('respects a window', () => {
    const workouts = [
      workout('2026-08-01', 'skipped'),
      workout('2026-08-24', 'completed'),
      workout('2026-08-25', 'completed'),
    ];
    const result = adherence(workouts, { start: '2026-08-18', end: '2026-08-24' });
    expect(result.resolved).toBe(1);
    expect(result.rate).toBe(1);
  });

  it('always lands between 0 and 1', () => {
    const statuses: WorkoutStatus[] = ['completed', 'skipped', 'rest', 'planned', 'in_progress'];
    for (let i = 0; i < 60; i++) {
      const workouts = Array.from({ length: (i % 9) + 1 }, (_, n) =>
        workout(`2026-08-${String((n % 28) + 1).padStart(2, '0')}`, statuses[(i + n) % 5]!)
      );
      const { rate } = adherence(workouts);
      if (rate !== null) {
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('currentStreak', () => {
  it('counts consecutive kept sessions backwards from the given day', () => {
    const workouts = [
      workout('2026-08-20', 'completed'),
      workout('2026-08-21', 'skipped'),
      workout('2026-08-22', 'completed'),
      workout('2026-08-23', 'rest'),
      workout('2026-08-24', 'completed'),
    ];
    expect(currentStreak(workouts, '2026-08-24')).toBe(3);
  });

  it('is unbroken by a scheduled rest day', () => {
    const workouts = [
      workout('2026-08-22', 'completed'),
      workout('2026-08-23', 'rest'),
      workout('2026-08-24', 'completed'),
    ];
    expect(currentStreak(workouts, '2026-08-24')).toBe(3);
  });

  it('is broken by a skipped day', () => {
    const workouts = [workout('2026-08-23', 'skipped'), workout('2026-08-24', 'completed')];
    expect(currentStreak(workouts, '2026-08-24')).toBe(1);
  });

  it('skips over days with nothing scheduled', () => {
    // An every-other-day programme must not reset on its off days.
    const workouts = [
      workout('2026-08-20', 'completed'),
      workout('2026-08-22', 'completed'),
      workout('2026-08-24', 'completed'),
    ];
    expect(currentStreak(workouts, '2026-08-24')).toBe(3);
  });

  it('ignores sessions after the reference day', () => {
    const workouts = [
      workout('2026-08-24', 'completed'),
      workout('2026-08-25', 'completed'),
      workout('2026-08-26', 'completed'),
    ];
    expect(currentStreak(workouts, '2026-08-24')).toBe(1);
  });

  it('is zero when the most recent resolved session was missed', () => {
    expect(currentStreak([workout('2026-08-24', 'skipped')], '2026-08-24')).toBe(0);
    expect(currentStreak([], '2026-08-24')).toBe(0);
  });
});
