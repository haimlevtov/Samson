/**
 * Two stub planners, shared by the golden test suite and the eval harness.
 *
 * WHY they live in one file: the suite and the script had their own copies for
 * about an hour, and the script's copy quietly skipped the injured-joint filter.
 * It still reported 30/30 accepted, because the first candidates in catalogue
 * order are abdominal work that loads no flagged joint. A stub that passes by
 * luck is worse than no stub — it produces a green table that means nothing.
 *
 * INVARIANT: neither of these is a model, and neither says anything about what
 *            a model would produce. `compliant` satisfies the rules by
 *            construction; that is the point and also the limit.
 */
import { JOINT_LOADING, type RuleCandidate, type RuleContext } from '../../src/planner/rules';
import type { PlannedSession, PlannedWeek, TrainingBlock } from '../../src/planner/schema';

/** Below every ceiling in the seeded archetypes, Yossi's 30 kg dumbbells included. */
export const STUB_WEIGHT_KG = 20;
export const STUB_REPS = 8;

export function loadsAnyInjured(
  candidate: Pick<RuleCandidate, 'primaryMuscle' | 'movementPattern'>,
  injured: readonly string[]
): boolean {
  return injured.some((joint) => {
    const loading = JOINT_LOADING[joint];
    if (loading === undefined) return false;
    if (loading.muscles.includes(candidate.primaryMuscle)) return true;
    return (
      candidate.movementPattern !== null && loading.patterns.includes(candidate.movementPattern)
    );
  });
}

/**
 * A block that satisfies all six rules.
 *
 * Week 1 starts under both volume guards at once — 5% over the recent baseline
 * and 40% of the way into the ACWR headroom — then climbs at half the allowance
 * so no later week can breach either.
 */
export function compliantBlock(
  context: RuleContext,
  weeks: number,
  daysPerWeek: number
): TrainingBlock {
  const usable = context.candidates.filter((c) => !loadsAnyInjured(c, context.injuredJoints));
  const chronic = context.chronicWeeklyTonnageKg;
  const baseline = context.baselineWeeklyTonnageKg;

  const first = Math.max(
    STUB_WEIGHT_KG * STUB_REPS,
    Math.min(baseline > 0 ? baseline * 1.05 : Infinity, chronic !== null ? chronic * 1.4 : Infinity)
  );

  const planWeeks: PlannedWeek[] = [];
  let target = first;

  for (let week = 1; week <= weeks; week++) {
    const isDeload = weeks >= 5 && week === 5;
    const setsNeeded = Math.max(
      1,
      Math.round((isDeload ? target * 0.6 : target) / (STUB_WEIGHT_KG * STUB_REPS))
    );
    const sessions: PlannedSession[] = [];

    for (let day = 0; day < daysPerWeek; day++) {
      const candidate = usable[day % Math.max(1, usable.length)];
      if (candidate === undefined) break;
      const perSession = Math.max(
        1,
        Math.floor(setsNeeded / daysPerWeek) + (day < setsNeeded % daysPerWeek ? 1 : 0)
      );
      sessions.push({
        day_index: day,
        focus: 'full body',
        exercises: [
          {
            exercise_slug: candidate.slug,
            // One group of N identical sets — the shape ADR 0007 moved to.
            set_groups: [
              {
                count: Math.min(perSession, 20),
                weight_kg: STUB_WEIGHT_KG,
                reps: STUB_REPS,
                rpe: 7,
                rest_seconds: 120,
              },
            ],
          },
        ],
      });
    }

    planWeeks.push({ week_number: week, is_deload: isDeload, sessions });
    // A deload does not become the next week's baseline — see rules.ts.
    if (!isDeload) target *= 1.05;
  }

  return { weeks: planWeeks, rationale: 'stub block satisfying every rule by construction' };
}

/**
 * The same block with the constraints thrown away: an invented exercise, an
 * absurd load, and no deload anywhere.
 *
 * Used to prove the gates actually reject, because a harness that only ever
 * sees compliant plans never exercises the half of the loop that matters.
 */
export function naiveBlock(
  context: RuleContext,
  weeks: number,
  daysPerWeek: number
): TrainingBlock {
  const compliant = compliantBlock(context, weeks, daysPerWeek);
  return {
    ...compliant,
    weeks: compliant.weeks.map((week) => ({
      ...week,
      is_deload: false,
      sessions: week.sessions.map((session) => ({
        ...session,
        exercises: session.exercises.map((exercise) => ({
          exercise_slug: 'an-exercise-nobody-owns',
          set_groups: exercise.set_groups.map((group) => ({ ...group, weight_kg: 400 })),
        })),
      })),
    })),
  };
}
