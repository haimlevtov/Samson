import { describe, expect, it } from 'vitest';
import type { DayWorkout } from '../db/training';
import { restToday } from './rest';

const day = (status: DayWorkout['status'], setCount = 0, id: string = status): DayWorkout => ({
  id,
  status,
  setCount,
});

describe('restToday', () => {
  it('offers a rest day on a day with nothing in it', () => {
    expect(restToday([])).toEqual({ kind: 'offer' });
  });

  it('still offers one beside a day that has not settled — planned or skipped', () => {
    expect(restToday([day('planned'), day('skipped')])).toEqual({ kind: 'offer' });
  });

  it('does not offer one on a day with training in it, finished or left open', () => {
    expect(restToday([day('completed', 6)])).toEqual({ kind: 'trained' });
    // An open session outside the active window, with sets: the user trained.
    expect(restToday([day('in_progress', 3)])).toEqual({ kind: 'trained' });
  });

  it('is not blocked by an empty session — a mis-tapped Start, finished or abandoned', () => {
    // FOUND IN REVIEW: nothing deletes one, so this blocked Rest today all day.
    expect(restToday([day('completed', 0)])).toEqual({ kind: 'offer' });
    expect(restToday([day('in_progress', 0)])).toEqual({ kind: 'offer' });
  });

  it('points at the rest day already logged, instead of offering a second', () => {
    expect(restToday([day('rest', 0, 'rest-1')])).toEqual({
      kind: 'rested',
      workoutId: 'rest-1',
    });
  });

  it('still says a day was a rest day when the user trained on it afterwards', () => {
    // ADR 0034 §4: training on a rest day is allowed, and the rest day stays.
    expect(restToday([day('completed', 8, 'session'), day('rest', 0, 'rest-1')])).toEqual({
      kind: 'rested',
      workoutId: 'rest-1',
    });
  });
});
