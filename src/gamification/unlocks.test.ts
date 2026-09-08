/**
 * Tests for `src/gamification/unlocks.ts`, written from
 * `docs/adr/0020-progression-unlock-criteria.md`.
 *
 * Two properties carry the weight. A criterion is met WITHIN ONE WORKOUT, so a
 * total accumulated over months must not unlock anything — that is the
 * difference between "you can do this" and "you have done this much". And a
 * node needs its parent unlocked, which is what makes the rows a tree rather
 * than a checklist: clearing the top rung by accident cannot skip the ones
 * below it.
 */
import { describe, expect, it } from 'vitest';
import {
  meetsCriteria,
  unlockCriteriaSchema,
  unlockStates,
  type ProgressionNode,
  type SlugSet,
} from './unlocks';

const set = (over: Partial<SlugSet> = {}): SlugSet => ({
  exerciseId: 'e1',
  exerciseSlug: 'pushups',
  workoutId: 'w1',
  weightKg: null,
  reps: 12,
  isWarmup: false,
  localDate: '2026-09-01',
  ...over,
});

const THREE_OF_TEN = unlockCriteriaSchema.parse({
  kind: 'sets_at',
  exercise: 'pushups',
  sets: 3,
  reps: 10,
});

const node = (over: Partial<ProgressionNode> = {}): ProgressionNode => ({
  slug: 'n',
  tree: 'push',
  name: 'A node',
  level: 0,
  parentSlug: null,
  exerciseSlug: 'pushups',
  criteria: {},
  ...over,
});

describe('the criteria schema', () => {
  it('accepts an empty object as a root', () => {
    expect(unlockCriteriaSchema.parse({})).toEqual({});
  });

  it('rejects anything it has no word for', () => {
    // ADR 0020: a criterion can only say what the schema has a vocabulary for,
    // and adding to that vocabulary is a schema change plus an evaluator branch
    // plus a test. Content is cheap; vocabulary is not.
    expect(unlockCriteriaSchema.safeParse({ kind: 'vibes', exercise: 'x' }).success).toBe(false);
    expect(unlockCriteriaSchema.safeParse({ kind: 'sets_at' }).success).toBe(false);
    expect(unlockCriteriaSchema.safeParse('select 1').success).toBe(false);
  });

  it('rejects an extra key rather than ignoring it', () => {
    // strictObject, so a typo'd field is a parse failure and not a silently
    // dropped intention.
    const withTypo = { kind: 'sets_at', exercise: 'pushups', sets: 3, reps: 10, repss: 12 };
    expect(unlockCriteriaSchema.safeParse(withTypo).success).toBe(false);
  });
});

describe('meetsCriteria', () => {
  it('is met by enough qualifying sets in one workout', () => {
    const sets = [set(), set(), set()];
    expect(meetsCriteria(THREE_OF_TEN, sets)).toBe(true);
  });

  it('is not met one set short', () => {
    expect(meetsCriteria(THREE_OF_TEN, [set(), set()])).toBe(false);
  });

  it('is not met one rep short', () => {
    const light = [set({ reps: 9 }), set({ reps: 9 }), set({ reps: 9 })];
    expect(meetsCriteria(THREE_OF_TEN, light)).toBe(false);
  });

  it('does NOT count sets spread across separate workouts', () => {
    /*
     * The property the whole shape turns on. Three sets of ten on three
     * different days is not three sets of ten — it says nothing about whether
     * the next rung is reachable, which is the only question a tree asks.
     */
    const spread = [set({ workoutId: 'a' }), set({ workoutId: 'b' }), set({ workoutId: 'c' })];
    expect(meetsCriteria(THREE_OF_TEN, spread)).toBe(false);
  });

  it('counts a qualifying workout among unqualifying ones', () => {
    const mixed = [
      set({ workoutId: 'a' }),
      set({ workoutId: 'b' }),
      set({ workoutId: 'c' }),
      set({ workoutId: 'c' }),
      set({ workoutId: 'c' }),
    ];
    expect(meetsCriteria(THREE_OF_TEN, mixed)).toBe(true);
  });

  it('ignores warm-ups', () => {
    // The same call src/metrics/tonnage.ts and every achievement predicate
    // make: a warm-up is not the work being rewarded.
    const warm = [set({ isWarmup: true }), set({ isWarmup: true }), set({ isWarmup: true })];
    expect(meetsCriteria(THREE_OF_TEN, warm)).toBe(false);
  });

  it('ignores a different exercise', () => {
    const other = Array.from({ length: 5 }, () => set({ exerciseSlug: 'chin-up' }));
    expect(meetsCriteria(THREE_OF_TEN, other)).toBe(false);
  });

  it('ignores a set with no reps recorded', () => {
    const blank = [set({ reps: null }), set({ reps: null }), set({ reps: null })];
    expect(meetsCriteria(THREE_OF_TEN, blank)).toBe(false);
  });

  it('treats a root as always met', () => {
    expect(meetsCriteria({}, [])).toBe(true);
  });

  describe('a weight floor', () => {
    const WEIGHTED = unlockCriteriaSchema.parse({
      kind: 'sets_at',
      exercise: 'weighted-pull-ups',
      sets: 3,
      reps: 5,
      weight_kg: 20,
    });

    const heavy = (weightKg: number | null) =>
      set({ exerciseSlug: 'weighted-pull-ups', reps: 5, weightKg });

    it('is met at the floor', () => {
      expect(meetsCriteria(WEIGHTED, [heavy(20), heavy(20), heavy(20)])).toBe(true);
    });

    it('is not met below it', () => {
      expect(meetsCriteria(WEIGHTED, [heavy(19.5), heavy(19.5), heavy(19.5)])).toBe(false);
    });

    it('does not count an unweighted set', () => {
      expect(meetsCriteria(WEIGHTED, [heavy(null), heavy(null), heavy(null)])).toBe(false);
    });

    it('does not lock out a bodyweight node when no floor is named', () => {
      // A criterion without weight_kg must ignore weight entirely, or every
      // bodyweight movement becomes unreachable — the reason tonnage.ts treats
      // an unloaded set as zero rather than as missing.
      const unloaded = [set({ weightKg: null }), set({ weightKg: null }), set({ weightKg: null })];
      expect(meetsCriteria(THREE_OF_TEN, unloaded)).toBe(true);
    });
  });
});

describe('unlockStates', () => {
  const ladder: ProgressionNode[] = [
    node({ slug: 'a', level: 0, parentSlug: null, criteria: {} }),
    node({ slug: 'b', level: 1, parentSlug: 'a', criteria: THREE_OF_TEN }),
    node({
      slug: 'c',
      level: 2,
      parentSlug: 'b',
      criteria: unlockCriteriaSchema.parse({
        kind: 'sets_at',
        exercise: 'chin-up',
        sets: 3,
        reps: 8,
      }),
    }),
  ];

  it('unlocks the root with no history at all', () => {
    const [a, b, c] = unlockStates(ladder, []);
    expect(a?.unlocked).toBe(true);
    expect(b?.unlocked).toBe(false);
    expect(c?.unlocked).toBe(false);
  });

  it('names the first locked node whose parent is open as next', () => {
    const states = unlockStates(ladder, []);
    expect(states.filter((s) => s.next).map((s) => s.node.slug)).toEqual(['b']);
  });

  it('unlocks the next rung once its criteria are met', () => {
    const states = unlockStates(ladder, [set(), set(), set()]);
    expect(states.map((s) => s.unlocked)).toEqual([true, true, false]);
    expect(states.filter((s) => s.next).map((s) => s.node.slug)).toEqual(['c']);
  });

  it('will not skip a rung, however good the history further up', () => {
    /*
     * The property that makes this a tree. Someone who can already do the
     * hardest movement but has never logged the easier one does not get the
     * top of the ladder handed to them — `met` records that they cleared the
     * criteria, `unlocked` records that the path to it is not open.
     */
    const chins = Array.from({ length: 3 }, () => set({ exerciseSlug: 'chin-up', reps: 8 }));
    const states = unlockStates(ladder, chins);

    const c = states.find((s) => s.node.slug === 'c');
    expect(c?.met, 'the criteria themselves are met').toBe(true);
    expect(c?.unlocked, 'but the rung below is not open').toBe(false);
  });

  it('treats a child whose parent it has not seen as locked', () => {
    // Guards the ordering contract rather than trusting it: a bad `level` or a
    // cycle shows up as an unreachable node instead of an infinite loop.
    const orphan = [node({ slug: 'x', level: 3, parentSlug: 'missing', criteria: {} })];
    expect(unlockStates(orphan, [])[0]?.unlocked).toBe(false);
  });
});
