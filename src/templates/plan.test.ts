/**
 * Tests for `src/templates/plan.ts`, written from
 * `docs/specs/workout-templates.md` §6.
 *
 * The claim this file exists to defend is the last one: a coach import must
 * never fail a bound the planner's own rules and the safety critic have already
 * passed. That is a statement about two schemas agreeing, and it is only
 * credible as a test — the constants sit in different files and nothing else
 * would notice one of them moving.
 */
import { describe, expect, it } from 'vitest';
import { plannedSessionSchema, type PlannedSession } from '../planner/schema';
import { templateDraftSchema } from './schema';
import { plannedSessionName, templateFromPlannedSession } from './plan';

const SQUAT_ID = '11111111-1111-4111-8111-111111111111';
const BENCH_ID = '22222222-2222-4222-8222-222222222222';

const ids = new Map([
  ['barbell-back-squat', SQUAT_ID],
  ['barbell-bench-press', BENCH_ID],
]);

const session: PlannedSession = {
  day_index: 2,
  focus: 'Lower body',
  exercises: [
    {
      exercise_slug: 'barbell-back-squat',
      set_groups: [
        { count: 1, reps: 5, weight_kg: 100, rpe: 8, rest_seconds: 180 },
        { count: 3, reps: 5, weight_kg: 90, rpe: null, rest_seconds: 150 },
      ],
    },
    {
      exercise_slug: 'barbell-bench-press',
      set_groups: [{ count: 3, reps: 8, weight_kg: null, rpe: 7, rest_seconds: 90 }],
    },
  ],
};

describe('templateFromPlannedSession', () => {
  it('copies every number verbatim, in order', () => {
    const result = templateFromPlannedSession(session, 2, ids);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.items).toEqual([
      { exerciseId: SQUAT_ID, setCount: 1, reps: 5, weightKg: 100, rpe: 8, restSeconds: 180 },
      { exerciseId: SQUAT_ID, setCount: 3, reps: 5, weightKg: 90, rpe: null, restSeconds: 150 },
      { exerciseId: BENCH_ID, setCount: 3, reps: 8, weightKg: null, rpe: 7, restSeconds: 90 },
    ]);
  });

  it('keeps a ramp as separate groups so the top set survives the import', () => {
    const result = templateFromPlannedSession(session, 1, ids);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The 1x5 @ 100 and the 3x5 @ 90 are different instructions. Collapsing
    // them would quietly delete the heaviest set of the day.
    expect(result.items.filter((i) => i.exerciseId === SQUAT_ID)).toHaveLength(2);
  });

  it('fails the whole import when a slug resolves to nothing, and names it', () => {
    const result = templateFromPlannedSession(
      session,
      2,
      new Map([['barbell-back-squat', SQUAT_ID]])
    );

    expect(result).toEqual({ ok: false, missingSlugs: ['barbell-bench-press'] });
  });

  it('names each missing slug once', () => {
    const repeated: PlannedSession = {
      ...session,
      exercises: [
        {
          exercise_slug: 'nope',
          set_groups: [{ count: 1, reps: 5, weight_kg: null, rpe: null, rest_seconds: 60 }],
        },
        {
          exercise_slug: 'nope',
          set_groups: [{ count: 1, reps: 5, weight_kg: null, rpe: null, rest_seconds: 60 }],
        },
      ],
    };

    const result = templateFromPlannedSession(repeated, 1, ids);

    expect(result).toEqual({ ok: false, missingSlugs: ['nope'] });
  });

  it('names the template after its place in the plan', () => {
    expect(plannedSessionName(2, session)).toBe('Week 2 · Day 3 — Lower body');
  });

  it('keeps a long focus inside the name bound', () => {
    const wordy: PlannedSession = { ...session, focus: 'x'.repeat(60) };

    const name = plannedSessionName(12, wordy);

    expect(name.length).toBeLessThanOrEqual(80);
    expect(() => templateDraftSchema.shape.name.parse(name)).not.toThrow();
  });

  it('accepts the largest session the planner can emit', () => {
    // 8 exercises of 4 set groups is the planner's ceiling, and every field is
    // at its own maximum. If this fails, a bound in one of the two schemas has
    // moved and a coach import would reject a plan that was already accepted.
    const slugs = Array.from({ length: 8 }, (_, i) => `movement-${i}`);
    const biggest: PlannedSession = {
      day_index: 6,
      focus: 'Everything',
      exercises: slugs.map((slug) => ({
        exercise_slug: slug,
        set_groups: Array.from({ length: 4 }, () => ({
          count: 20,
          reps: 50,
          weight_kg: 500,
          rpe: 10,
          rest_seconds: 900,
        })),
      })),
    };
    // Proves the fixture is a session the planner could actually produce,
    // rather than one invented to make this test pass.
    expect(() => plannedSessionSchema.parse(biggest)).not.toThrow();

    const result = templateFromPlannedSession(
      biggest,
      12,
      new Map(slugs.map((slug, i) => [slug, `${i}1111111-1111-4111-8111-111111111111`]))
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(() =>
      templateDraftSchema.parse({
        name: result.name,
        source: 'coach',
        notes: null,
        items: result.items,
      })
    ).not.toThrow();
  });
});
