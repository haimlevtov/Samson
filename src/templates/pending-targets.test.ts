/**
 * Tests for `pendingTargets` — the rule that turns a prescription into the
 * rows the session screen shows, ADR 0010 rendered through ADR 0011.
 *
 * The allocation itself is `templateProgress`'s job and is tested in
 * progress.test.ts. What is tested here is what survives that allocation: how
 * many rows are left, in what order, and whether their keys hold still.
 */
import { describe, expect, it } from 'vitest';
import { pendingTargets, type LoggedSetLike, type PrescribedSetGroup } from './progress';

function group(overrides: Partial<PrescribedSetGroup> = {}): PrescribedSetGroup {
  return {
    id: 'item-1',
    exerciseId: 'squat',
    setCount: 3,
    reps: 5,
    weightKg: 60,
    rpe: null,
    restSeconds: 120,
    ...overrides,
  };
}

function performed(exerciseId: string, count: number, isWarmup = false): LoggedSetLike[] {
  return Array.from({ length: count }, () => ({ exerciseId, isWarmup }));
}

describe('pendingTargets', () => {
  it('offers one row per prescribed set when nothing is done', () => {
    const rows = pendingTargets([group()], []);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ exerciseId: 'squat', weightKg: 60, reps: 5, restSeconds: 120 });
  });

  it('drops the sets that have been performed', () => {
    expect(pendingTargets([group()], performed('squat', 2))).toHaveLength(1);
  });

  it('offers nothing once the prescription is met', () => {
    expect(pendingTargets([group()], performed('squat', 3))).toEqual([]);
  });

  it('does not go negative when more was done than asked', () => {
    expect(pendingTargets([group()], performed('squat', 7))).toEqual([]);
  });

  it('ignores warm-ups, which a template never prescribes', () => {
    // Three warm-up sets are not three sets of the target. Counting them would
    // let a ramp-up empty the whole prescription without a working set logged.
    expect(pendingTargets([group()], performed('squat', 3, true))).toHaveLength(3);
  });

  it('keeps the keys of later rows still as earlier ones are performed', () => {
    const before = pendingTargets([group()], []).map((r) => r.key);
    const after = pendingTargets([group()], performed('squat', 1)).map((r) => r.key);

    // The edit a user made to row three must not follow row two around when
    // row one is ticked — the override is stored against this key.
    expect(after).toEqual(before.slice(1));
  });

  it('keeps groups in prescribed order across exercises', () => {
    const rows = pendingTargets(
      [
        group({ id: 'a', exerciseId: 'squat', setCount: 1 }),
        group({ id: 'b', exerciseId: 'bench', setCount: 1 }),
        group({ id: 'c', exerciseId: 'squat', setCount: 1, weightKg: 80 }),
      ],
      []
    );

    expect(rows.map((r) => r.itemId)).toEqual(['a', 'b', 'c']);
    expect(rows[2]?.weightKg).toBe(80);
  });

  it('allocates within an exercise across its own groups, in order', () => {
    // A ramp: one at 60, then three at 80. One set done is the 60, not a 80.
    const rows = pendingTargets(
      [
        group({ id: 'ramp', setCount: 1, weightKg: 60 }),
        group({ id: 'work', setCount: 3, weightKg: 80 }),
      ],
      performed('squat', 1)
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.weightKg === 80)).toBe(true);
  });

  it('carries a bodyweight prescription through as bodyweight', () => {
    const rows = pendingTargets([group({ exerciseId: 'pullup', weightKg: null, setCount: 1 })], []);
    expect(rows[0]?.weightKg).toBeNull();
  });

  it('marks its keys as template-owned', () => {
    // app/workouts/[id] routes edits by this prefix: a target's changes are an
    // override, a hand-added row's changes are the row itself.
    expect(pendingTargets([group()], []).every((r) => r.key.startsWith('t:'))).toBe(true);
  });
});
