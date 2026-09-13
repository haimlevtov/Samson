import { describe, expect, it } from 'vitest';
import { restToday } from './rest';

describe('restToday', () => {
  it('offers a rest day on a day with nothing in it', () => {
    expect(restToday([])).toEqual({ kind: 'offer' });
  });

  it('still offers one beside a day that has not settled — planned or skipped', () => {
    expect(
      restToday([
        { id: 'a', status: 'planned' },
        { id: 'b', status: 'skipped' },
      ])
    ).toEqual({ kind: 'offer' });
  });

  it('does not offer one on a day with a finished session, or a running one', () => {
    expect(restToday([{ id: 'a', status: 'completed' }])).toEqual({ kind: 'trained' });
    expect(restToday([{ id: 'a', status: 'in_progress' }])).toEqual({ kind: 'trained' });
  });

  it('points at the rest day already logged, instead of offering a second', () => {
    expect(restToday([{ id: 'rest-1', status: 'rest' }])).toEqual({
      kind: 'rested',
      workoutId: 'rest-1',
    });
  });

  it('still says a day was a rest day when the user trained on it afterwards', () => {
    // ADR 0034 §4: training on a rest day is allowed, and the rest day stays.
    expect(
      restToday([
        { id: 'session', status: 'completed' },
        { id: 'rest-1', status: 'rest' },
      ])
    ).toEqual({ kind: 'rested', workoutId: 'rest-1' });
  });
});
