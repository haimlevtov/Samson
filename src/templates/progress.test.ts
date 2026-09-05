/**
 * Tests for `src/templates/progress.ts`, written from
 * `docs/specs/workout-templates.md` §4.
 *
 * This is the one derived number the template feature shows a user, so the four
 * rules in §4 each get a case that fails when the rule is dropped, plus two
 * properties over generated input for the bounds that must hold whatever is
 * logged.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { templateProgress, type LoggedSetLike, type PrescribedItem } from './progress';

const SQUAT = '11111111-1111-4111-8111-111111111111';
const BENCH = '22222222-2222-4222-8222-222222222222';
const CURL = '33333333-3333-4333-8333-333333333333';

const item = (id: string, exerciseId: string, setCount: number): PrescribedItem => ({
  id,
  exerciseId,
  setCount,
});

const working = (exerciseId: string, count: number): LoggedSetLike[] =>
  Array.from({ length: count }, () => ({ exerciseId, isWarmup: false }));

describe('templateProgress', () => {
  it('reports nothing done when nothing has been logged', () => {
    const result = templateProgress([item('a', SQUAT, 5)], []);

    expect(result.completedSets).toBe(0);
    expect(result.prescribedSets).toBe(5);
    expect(result.ratio).toBe(0);
    // The opening state of every session started from a template, so it must
    // render rather than being an absent-data case — ADR 0010.
    expect(result.items).toEqual([{ itemId: 'a', prescribed: 5, done: 0 }]);
  });

  it('counts an empty template as 0 rather than dividing by zero', () => {
    const result = templateProgress([], working(SQUAT, 3));

    expect(result.ratio).toBe(0);
    expect(result.prescribedSets).toBe(0);
    expect(Number.isNaN(result.ratio)).toBe(false);
  });

  // §4 rule 1
  it('never counts a warm-up toward a target', () => {
    const sets: LoggedSetLike[] = [
      { exerciseId: SQUAT, isWarmup: true },
      { exerciseId: SQUAT, isWarmup: true },
      { exerciseId: SQUAT, isWarmup: false },
    ];

    const result = templateProgress([item('a', SQUAT, 3)], sets);

    expect(result.completedSets).toBe(1);
    expect(result.extraSets).toBe(0);
  });

  // §4 rule 2 — the case that needs the rule: one movement, two groups.
  it('fills a ramp in position order', () => {
    const items = [item('top', SQUAT, 1), item('back-off', SQUAT, 3)];

    expect(templateProgress(items, working(SQUAT, 1)).items).toEqual([
      { itemId: 'top', prescribed: 1, done: 1 },
      { itemId: 'back-off', prescribed: 3, done: 0 },
    ]);

    expect(templateProgress(items, working(SQUAT, 3)).items).toEqual([
      { itemId: 'top', prescribed: 1, done: 1 },
      { itemId: 'back-off', prescribed: 3, done: 2 },
    ]);
  });

  // §4 rule 3
  it('caps an item at what it prescribed and reports the surplus', () => {
    const result = templateProgress([item('a', SQUAT, 3)], working(SQUAT, 5));

    expect(result.items).toEqual([{ itemId: 'a', prescribed: 3, done: 3 }]);
    expect(result.completedSets).toBe(3);
    // Reported, not hidden: a bar stuck at 100% with no explanation is how a
    // user learns the number is not about them.
    expect(result.extraSets).toBe(2);
    expect(result.ratio).toBe(1);
  });

  // §4 rule 4
  it('ignores sets of a movement the template never asked for', () => {
    const result = templateProgress(
      [item('a', SQUAT, 2)],
      [...working(SQUAT, 2), ...working(CURL, 4)]
    );

    expect(result.completedSets).toBe(2);
    // Not extra work against this plan — different work.
    expect(result.extraSets).toBe(0);
  });

  it('spreads across exercises independently', () => {
    const items = [item('a', SQUAT, 3), item('b', BENCH, 3)];
    const result = templateProgress(items, [...working(SQUAT, 3), ...working(BENCH, 1)]);

    expect(result.items).toEqual([
      { itemId: 'a', prescribed: 3, done: 3 },
      { itemId: 'b', prescribed: 3, done: 1 },
    ]);
    expect(result.ratio).toBeCloseTo(4 / 6);
  });

  it('never reports more done than prescribed, whatever is logged', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            exerciseId: fc.constantFrom(SQUAT, BENCH),
            n: fc.integer({ min: 1, max: 6 }),
          }),
          {
            minLength: 1,
            maxLength: 5,
          }
        ),
        fc.array(
          fc.record({
            exerciseId: fc.constantFrom(SQUAT, BENCH, CURL),
            isWarmup: fc.boolean(),
          }),
          { maxLength: 40 }
        ),
        (prescriptions, sets) => {
          const items = prescriptions.map((p, i) => item(`i${i}`, p.exerciseId, p.n));
          const result = templateProgress(items, sets);

          expect(result.completedSets).toBeLessThanOrEqual(result.prescribedSets);
          expect(result.ratio).toBeGreaterThanOrEqual(0);
          expect(result.ratio).toBeLessThanOrEqual(1);
          for (const progress of result.items) {
            expect(progress.done).toBeLessThanOrEqual(progress.prescribed);
            expect(progress.done).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('accounts for every working set of a prescribed movement', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 8 }),
        (logged, prescribed) => {
          const result = templateProgress([item('a', SQUAT, prescribed)], working(SQUAT, logged));
          // Nothing is silently lost: what was logged is either progress or surplus.
          expect(result.completedSets + result.extraSets).toBe(logged);
        }
      ),
      { numRuns: 200 }
    );
  });
});
