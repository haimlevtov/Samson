/**
 * Tests for `src/templates/derive.ts`, written from
 * `docs/specs/workout-templates.md` §5.
 *
 * The property that matters is that a derived template is always a *valid*
 * template — the deriver reads rows a user typed, and `sets` accepts values a
 * prescription cannot carry (0 reps, no reps at all). Every case below ends up
 * against `templateItemDraftSchema` for that reason.
 */
import { describe, expect, it } from 'vitest';
import { templateFromSession, type SessionSetLike } from './derive';
import { MAX_TEMPLATE_ITEMS, templateItemDraftSchema } from './schema';

const SQUAT = '11111111-1111-4111-8111-111111111111';
const BENCH = '22222222-2222-4222-8222-222222222222';

const set = (
  over: Partial<SessionSetLike> & Pick<SessionSetLike, 'exerciseId' | 'setIndex'>
): SessionSetLike => ({
  weightKg: 60,
  reps: 5,
  restSeconds: 120,
  isWarmup: false,
  ...over,
});

describe('templateFromSession', () => {
  it('collapses consecutive identical sets into one group', () => {
    const derived = templateFromSession([
      set({ exerciseId: SQUAT, setIndex: 0 }),
      set({ exerciseId: SQUAT, setIndex: 1 }),
      set({ exerciseId: SQUAT, setIndex: 2 }),
    ]);

    expect(derived.items).toEqual([
      { exerciseId: SQUAT, setCount: 3, reps: 5, weightKg: 60, rpe: null, restSeconds: 120 },
    ]);
    expect(derived.truncated).toBe(false);
  });

  it('starts a new group when the weight or the reps change', () => {
    const derived = templateFromSession([
      set({ exerciseId: SQUAT, setIndex: 0, weightKg: 60 }),
      set({ exerciseId: SQUAT, setIndex: 1, weightKg: 70 }),
      set({ exerciseId: SQUAT, setIndex: 2, weightKg: 70 }),
      set({ exerciseId: SQUAT, setIndex: 3, weightKg: 70, reps: 3 }),
    ]);

    expect(derived.items.map((i) => [i.setCount, i.reps, i.weightKg])).toEqual([
      [1, 5, 60],
      [2, 5, 70],
      [1, 3, 70],
    ]);
  });

  it('does not merge two runs of the same numbers that are not adjacent', () => {
    // 60, 70, 60 is a wave, not three sets at two weights. Merging the ends
    // would prescribe a session that was never performed.
    const derived = templateFromSession([
      set({ exerciseId: SQUAT, setIndex: 0, weightKg: 60 }),
      set({ exerciseId: SQUAT, setIndex: 1, weightKg: 70 }),
      set({ exerciseId: SQUAT, setIndex: 2, weightKg: 60 }),
    ]);

    expect(derived.items).toHaveLength(3);
  });

  // §5 rule 1
  it('drops warm-ups', () => {
    const derived = templateFromSession([
      set({ exerciseId: SQUAT, setIndex: 0, weightKg: 20, isWarmup: true }),
      set({ exerciseId: SQUAT, setIndex: 1, weightKg: 60 }),
    ]);

    expect(derived.items).toEqual([
      { exerciseId: SQUAT, setCount: 1, reps: 5, weightKg: 60, rpe: null, restSeconds: 120 },
    ]);
  });

  // §5 rule 3
  it('never carries RPE, because RPE is an outcome rather than an instruction', () => {
    const derived = templateFromSession([
      set({ exerciseId: SQUAT, setIndex: 0 }),
      set({ exerciseId: SQUAT, setIndex: 1 }),
    ]);

    // One group, not two, which is the point: grouping by how hard each set
    // felt would shatter every derived template into single sets.
    expect(derived.items).toHaveLength(1);
    expect(derived.items[0]?.rpe).toBeNull();
  });

  it('takes rest from the first set of a run', () => {
    const derived = templateFromSession([
      set({ exerciseId: SQUAT, setIndex: 0, restSeconds: 180 }),
      set({ exerciseId: SQUAT, setIndex: 1, restSeconds: 90 }),
    ]);

    expect(derived.items[0]?.restSeconds).toBe(180);
  });

  it('keeps bodyweight as bodyweight rather than as zero', () => {
    const derived = templateFromSession([set({ exerciseId: BENCH, setIndex: 0, weightKg: null })]);

    expect(derived.items[0]?.weightKg).toBeNull();
  });

  it('skips sets that cannot be expressed as a prescription', () => {
    const derived = templateFromSession([
      set({ exerciseId: SQUAT, setIndex: 0, reps: null }),
      set({ exerciseId: SQUAT, setIndex: 1, reps: 0 }),
      set({ exerciseId: SQUAT, setIndex: 2, reps: 51 }),
      set({ exerciseId: SQUAT, setIndex: 3, reps: 5 }),
    ]);

    expect(derived.items).toHaveLength(1);
    expect(derived.items[0]?.reps).toBe(5);
  });

  it('yields nothing at all from a session with nothing prescribable in it', () => {
    // The caller turns this into a message rather than an empty template.
    const derived = templateFromSession([
      set({ exerciseId: SQUAT, setIndex: 0, isWarmup: true }),
      set({ exerciseId: SQUAT, setIndex: 1, reps: null }),
    ]);

    expect(derived.items).toEqual([]);
  });

  it('orders exercises as the session ran and sets by index within each', () => {
    const derived = templateFromSession([
      set({ exerciseId: BENCH, setIndex: 1, weightKg: 40 }),
      set({ exerciseId: SQUAT, setIndex: 0, weightKg: 100 }),
      set({ exerciseId: BENCH, setIndex: 0, weightKg: 30 }),
    ]);

    expect(derived.items.map((i) => [i.exerciseId, i.weightKg])).toEqual([
      // Bench appeared first in the input, and its own sets sort by index.
      [BENCH, 30],
      [BENCH, 40],
      [SQUAT, 100],
    ]);
  });

  it('splits a run longer than a single group can hold', () => {
    const sets = Array.from({ length: 25 }, (_, i) => set({ exerciseId: SQUAT, setIndex: i }));

    const derived = templateFromSession(sets);

    // set_count is capped at 20 by the schema and the check constraint alike.
    expect(derived.items.map((i) => i.setCount)).toEqual([20, 5]);
  });

  it('reports truncation rather than silently losing the tail', () => {
    // Every set a different weight, so every one is its own group.
    const sets = Array.from({ length: MAX_TEMPLATE_ITEMS + 3 }, (_, i) =>
      set({ exerciseId: SQUAT, setIndex: i, weightKg: 40 + i })
    );

    const derived = templateFromSession(sets);

    expect(derived.items).toHaveLength(MAX_TEMPLATE_ITEMS);
    expect(derived.truncated).toBe(true);
  });

  it('only ever produces items a template can store', () => {
    const derived = templateFromSession([
      set({ exerciseId: SQUAT, setIndex: 0, weightKg: 500, reps: 50 }),
      set({ exerciseId: SQUAT, setIndex: 1, weightKg: 0, reps: 1, restSeconds: null }),
      set({ exerciseId: BENCH, setIndex: 0, weightKg: null }),
    ]);

    for (const item of derived.items) {
      expect(() => templateItemDraftSchema.parse(item)).not.toThrow();
    }
  });
});
