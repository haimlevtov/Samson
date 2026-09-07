/**
 * The facts the coach is given.
 *
 * These are the only numbers the chat may quote — ADR 0015 §4 — so a wrong
 * figure here is not a display bug, it is the coach confidently stating
 * something false about somebody's training. Every field is asserted against a
 * hand-checked fixture rather than against another call to the same code.
 */
import { describe, expect, it } from 'vitest';
import type { SetRecord, WorkoutRecord } from '../metrics/types';
import { MAX_TOP_LIFTS, coachFacts, type CoachFactsInput } from './facts';

/** A Wednesday, so "this week" and "last week" are both non-trivial. */
const TODAY = '2026-09-09';

const WORKOUTS: WorkoutRecord[] = [
  { id: 'w1', localDate: '2026-09-09', status: 'completed' },
  { id: 'w2', localDate: '2026-09-08', status: 'completed' },
  { id: 'w3', localDate: '2026-09-02', status: 'completed' },
  { id: 'w4', localDate: '2026-08-20', status: 'skipped' },
  { id: 'w5', localDate: '2026-06-17', status: 'completed' },
];

const set = (
  exerciseId: string,
  localDate: string,
  weightKg: number,
  reps: number,
  isWarmup = false
): SetRecord => ({ exerciseId, localDate, weightKg, reps, isWarmup });

const SETS: SetRecord[] = [
  set('sq', '2026-09-08', 60, 5, true), // warmup: never counted, never a best
  set('sq', '2026-09-08', 100, 5),
  set('bp', '2026-09-09', 80, 5),
  set('sq', '2026-09-02', 95, 5),
  set('sq', '2026-06-17', 77.5, 5),
];

const NAMES = new Map([
  ['sq', 'Barbell Full Squat'],
  ['bp', 'Barbell Bench Press'],
]);

const input = (over: Partial<CoachFactsInput> = {}): CoachFactsInput => ({
  today: TODAY,
  workouts: WORKOUTS,
  sets: SETS,
  exerciseNames: NAMES,
  lifetimeXp: 400,
  ...over,
});

describe('coachFacts — attendance', () => {
  it('counts completed sessions in each window', () => {
    const facts = coachFacts(input());
    // 09-03 onwards: the 9th and the 8th. The 2nd is outside seven days.
    expect(facts.sessions_last_7_days).toBe(2);
    // 08-13 onwards: adds the 2nd. June is outside twenty-eight days.
    expect(facts.sessions_last_28_days).toBe(3);
  });

  it('reports adherence as a whole percent over resolved days only', () => {
    // Four resolved in the window — three completed, one skipped.
    expect(coachFacts(input()).adherence_28d_percent).toBe(75);
  });

  it('leaves adherence null when nothing has resolved, rather than zero', () => {
    // WHY it matters: "has not started" and "missed everything" are opposite
    // facts, and a 0 here would let the coach berate a brand new user.
    const facts = coachFacts(input({ workouts: [], sets: [] }));
    expect(facts.adherence_28d_percent).toBeNull();
  });

  it('counts the streak up to the first day that was not kept', () => {
    expect(coachFacts(input()).current_streak_days).toBe(3);
  });

  it('reports days since the last session, and null when there has never been one', () => {
    expect(coachFacts(input()).days_since_last_session).toBe(0);
    expect(coachFacts(input({ today: '2026-09-12' })).days_since_last_session).toBe(3);
    expect(coachFacts(input({ workouts: [], sets: [] })).days_since_last_session).toBeNull();
  });
});

describe('coachFacts — load', () => {
  it('splits tonnage into this week and last week, excluding warmups', () => {
    const facts = coachFacts(input());
    // Monday 09-07 onwards: 100x5 + 80x5. The 60 kg warmup contributes nothing.
    expect(facts.tonnage_this_week_kg).toBe(900);
    // The week of Monday 08-31: 95x5.
    expect(facts.tonnage_last_week_kg).toBe(475);
  });

  it('rounds tonnage to whole kilograms', () => {
    // Plate maths produces long decimals, and every spurious digit is another
    // numeral the reply would be allowed to quote.
    const facts = coachFacts(input({ sets: [set('sq', '2026-09-08', 62.5, 3)] }));
    expect(Number.isInteger(facts.tonnage_this_week_kg)).toBe(true);
  });

  it('keeps ACWR to two decimals and always names a band', () => {
    const facts = coachFacts(input());
    if (facts.acwr !== null) expect(Number(facts.acwr.toFixed(2))).toBe(facts.acwr);
    expect(['unknown', 'low', 'sweet-spot', 'high', 'danger']).toContain(facts.acwr_band);
  });

  it('says unknown rather than guessing when history is too short', () => {
    const facts = coachFacts(input({ workouts: [], sets: [] }));
    expect(facts.acwr).toBeNull();
    expect(facts.acwr_band).toBe('unknown');
  });
});

describe('coachFacts — level', () => {
  it('reports the level and the gap, both from levelProgress', () => {
    const facts = coachFacts(input());
    expect(facts.lifetime_xp).toBe(400);
    expect(facts.level).toBe(2);
    // The bar and the label come from one call, so they cannot disagree — the
    // agreement property in docs/specs/xp-and-challenges.md.
    expect(facts.xp_to_next_level).toBe(275);
  });
});

describe('coachFacts — top lifts', () => {
  it('ranks by heaviest working set and names them from the catalogue', () => {
    const lifts = coachFacts(input()).top_lifts;
    expect(lifts).toEqual([
      { name: 'Barbell Full Squat', heaviest_kg: 100, on_date: '2026-09-08' },
      { name: 'Barbell Bench Press', heaviest_kg: 80, on_date: '2026-09-09' },
    ]);
  });

  it('never counts a warmup as a best', () => {
    const facts = coachFacts(input({ sets: [set('sq', '2026-09-08', 200, 1, true)] }));
    expect(facts.top_lifts).toEqual([]);
  });

  it('caps the list, because every entry widens what the reply may quote', () => {
    const many = Array.from({ length: 12 }, (_, i) => set(`ex${i}`, '2026-09-08', 50 + i, 5));
    const names = new Map(many.map((s, i) => [s.exerciseId, `Lift ${i}`]));
    const facts = coachFacts(input({ sets: many, exerciseNames: names }));
    expect(facts.top_lifts).toHaveLength(MAX_TOP_LIFTS);
    // Heaviest first: 61 down to 57.
    expect(facts.top_lifts[0]?.heaviest_kg).toBe(61);
  });

  it('falls back to the id when the catalogue has no name for it', () => {
    // A missing name must not drop the lift silently — that would make the
    // coach's picture of somebody's training quietly incomplete.
    const facts = coachFacts(input({ exerciseNames: new Map() }));
    expect(facts.top_lifts.map((l) => l.name)).toEqual(['sq', 'bp']);
  });

  it('orders ties by name, so identical inputs produce an identical payload', () => {
    const tied = [set('a', '2026-09-08', 90, 5), set('b', '2026-09-08', 90, 5)];
    const names = new Map([
      ['a', 'Zercher Squat'],
      ['b', 'Ab Wheel'],
    ]);
    expect(coachFacts(input({ sets: tied, exerciseNames: names })).top_lifts[0]?.name).toBe(
      'Ab Wheel'
    );
  });
});

describe('coachFacts — an empty history', () => {
  it('produces a complete payload rather than throwing', () => {
    // The first message a new user sends goes through this exact path.
    const facts = coachFacts(input({ workouts: [], sets: [], lifetimeXp: 0 }));
    expect(facts).toMatchObject({
      as_of: TODAY,
      sessions_last_7_days: 0,
      sessions_last_28_days: 0,
      adherence_28d_percent: null,
      current_streak_days: 0,
      days_since_last_session: null,
      tonnage_this_week_kg: 0,
      tonnage_last_week_kg: 0,
      acwr: null,
      level: 1,
      lifetime_xp: 0,
      top_lifts: [],
    });
  });
});
