/**
 * The golden set, run offline against a deterministic stub planner.
 *
 * WHAT THIS PROVES, precisely — because the distinction is the whole point:
 *
 *   It proves the six rules are **jointly satisfiable** on all thirty real
 *   histories. If the volume cap, the ACWR guard, the deload requirement, the
 *   equipment ceilings and two injury exclusions could not all be met at once
 *   for some user, every plan that user ever asked for would be rejected three
 *   times and the loop would exhaust. That is the phase's central risk and it
 *   is checkable without a model.
 *
 *   It proves the context builder turns real seeded history into a valid
 *   PlannerInput for every archetype, and that the loop reaches `accepted`
 *   within the retry cap when handed a compliant block.
 *
 * WHAT IT DOES NOT PROVE: that a real model writes good training. A stub that
 * satisfies the rules by construction says nothing about whether Sonnet does,
 * and reporting this suite as evidence of planner quality would be exactly the
 * verification theatre PLAN.md warns against. The live run needs a key and has
 * not happened.
 */
import { describe, expect, it } from 'vitest';
import { buildPlannerContext } from '../../src/planner/context';
import { generatePlan } from '../../src/planner/loop';
import { checkRules, JOINT_LOADING, type RuleContext } from '../../src/planner/rules';
import {
  plannerInputSchema,
  trainingBlockSchema,
  type CriticVerdict,
  type PlannedSession,
  type PlannedWeek,
  type TrainingBlock,
} from '../../src/planner/schema';
import type { CallOptions, LlmResult } from '../../src/llm/types';
import type { PlanRunInsert, PlanRunStore } from '../../src/planner/types';
import { catalogueVocabulary, goldenCases, GOLDEN_AS_OF, type GoldenCase } from '../planner/golden';

const CASES = goldenCases();

/** Deliberately below every ceiling in the seeded archetypes, Yossi's 30 kg included. */
const STUB_WEIGHT_KG = 20;
const STUB_REPS = 8;

function loadsAnyInjured(
  candidate: { primaryMuscle: string; movementPattern: string | null },
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
 * A planner that obeys the constraints by construction.
 *
 * It is not a model and does not pretend to be one. Its only job is to
 * demonstrate that a block satisfying all six rules exists for each case.
 */
function stubPlan(context: RuleContext, weeks: number, daysPerWeek: number): TrainingBlock {
  const usable = context.candidates.filter((c) => !loadsAnyInjured(c, context.injuredJoints));

  // Start just under the cap on both guards, then climb at half the allowance.
  const chronic = context.chronicWeeklyTonnageKg;
  const baseline = context.baselineWeeklyTonnageKg;
  const firstWeek = Math.max(
    STUB_WEIGHT_KG * STUB_REPS,
    Math.min(baseline > 0 ? baseline * 1.05 : Infinity, chronic !== null ? chronic * 1.4 : Infinity)
  );

  const planWeeks: PlannedWeek[] = [];
  let target = firstWeek;

  for (let week = 1; week <= weeks; week++) {
    const isDeload = weeks >= 5 && week === 5;
    const weekTarget = isDeload ? target * 0.6 : target;

    const setsNeeded = Math.max(1, Math.round(weekTarget / (STUB_WEIGHT_KG * STUB_REPS)));
    const sessions: PlannedSession[] = [];

    for (let day = 0; day < daysPerWeek; day++) {
      const perSession = Math.max(
        1,
        Math.floor(setsNeeded / daysPerWeek) + (day < setsNeeded % daysPerWeek ? 1 : 0)
      );
      const candidate = usable[day % usable.length];
      if (candidate === undefined) break;

      sessions.push({
        day_index: day,
        focus: 'full body',
        exercises: [
          {
            exercise_slug: candidate.slug,
            sets: Array.from({ length: Math.min(perSession, 12) }, (_, i) => ({
              set_index: i,
              weight_kg: STUB_WEIGHT_KG,
              reps: STUB_REPS,
              rpe: 7,
              rest_seconds: 120,
            })),
          },
        ],
      });
    }

    planWeeks.push({ week_number: week, is_deload: isDeload, sessions });
    // A deload does not become the next week's baseline — see rules.ts.
    if (!isDeload) target = target * 1.05;
  }

  return { weeks: planWeeks, rationale: 'stub block for the offline golden run' };
}

function contextFor(golden: GoldenCase) {
  return buildPlannerContext({
    goal: golden.goal,
    daysPerWeek: golden.daysPerWeek,
    blockWeeks: golden.blockWeeks,
    injuredJoints: golden.injuredJoints,
    asOf: GOLDEN_AS_OF,
    workouts: golden.workouts,
    sets: golden.sets,
    candidates: golden.candidates,
  });
}

describe('golden set', () => {
  it('builds thirty cases from five archetypes', () => {
    expect(CASES).toHaveLength(30);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(30);
  });

  it.each(CASES.map((c) => [c.id, c] as const))(
    '%s — every candidate list is non-empty and equipment-filtered',
    (_id, golden) => {
      expect(golden.candidates.length).toBeGreaterThan(0);
      const owned = new Set(golden.archetype.equipment.map((e) => e.slug));
      for (const candidate of golden.candidates) {
        for (const item of candidate.equipment) {
          expect(owned).toContain(item.slug);
        }
      }
    }
  );

  it.each(CASES.map((c) => [c.id, c] as const))(
    '%s — real history produces a schema-valid PlannerInput',
    (_id, golden) => {
      const { plannerInput } = contextFor(golden);
      expect(plannerInputSchema.safeParse(plannerInput).success).toBe(true);
      expect(plannerInput.metrics.weekly_tonnage_kg.length).toBeGreaterThan(0);
    }
  );

  it.each(CASES.map((c) => [c.id, c] as const))(
    '%s — the six rules are jointly satisfiable',
    (_id, golden) => {
      const { ruleContext } = contextFor(golden);
      const block = stubPlan(ruleContext, golden.blockWeeks, golden.daysPerWeek);

      expect(trainingBlockSchema.safeParse(block).success).toBe(true);

      // WHY this guard: an empty block passes all six rules trivially — zero
      // tonnage never exceeds a cap and an exercise that is not prescribed
      // cannot breach a ceiling. Without asserting the stub actually
      // prescribes work, a case where the injury filter left no usable
      // candidate would report as satisfiable when it is the opposite.
      const prescribed = block.weeks.flatMap((w) => w.sessions).length;
      expect(prescribed).toBeGreaterThan(0);
      const tonnage = block.weeks
        .flatMap((w) => w.sessions)
        .flatMap((s) => s.exercises)
        .flatMap((e) => e.sets)
        .reduce((sum, set) => sum + (set.weight_kg ?? 0) * set.reps, 0);
      expect(tonnage).toBeGreaterThan(0);
      // The assertion that matters: if this ever fails, some user can never be
      // given a plan at all, and no amount of prompt work would fix it.
      expect(checkRules(block, ruleContext)).toEqual([]);
    }
  );

  it.each(CASES.map((c) => [c.id, c] as const))(
    '%s — a block ignoring the constraints is rejected',
    (_id, golden) => {
      const { ruleContext } = contextFor(golden);
      const compliant = stubPlan(ruleContext, golden.blockWeeks, golden.daysPerWeek);

      // Same block, one invented exercise and double the load.
      const naive: TrainingBlock = {
        ...compliant,
        weeks: compliant.weeks.map((week) => ({
          ...week,
          is_deload: false,
          sessions: week.sessions.map((session) => ({
            ...session,
            exercises: session.exercises.map((exercise) => ({
              exercise_slug: 'an-exercise-nobody-owns',
              sets: exercise.sets.map((set) => ({ ...set, weight_kg: 400 })),
            })),
          })),
        })),
      };

      const findings = checkRules(naive, ruleContext);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.map((f) => f.code)).toContain('equipment_available');
    }
  );

  it.each(CASES.map((c) => [c.id, c] as const))(
    '%s — the loop accepts a compliant block within the retry cap',
    async (_id, golden) => {
      const { plannerInput, ruleContext } = contextFor(golden);
      const block = stubPlan(ruleContext, golden.blockWeeks, golden.daysPerWeek);
      const approved: CriticVerdict = { approved: true, reasons: [] };

      const written: PlanRunInsert[] = [];
      const plans: PlanRunStore = {
        async insertPlanRun(row) {
          written.push(row);
        },
      };

      let call = 0;
      const result = await generatePlan('golden-user', plannerInput, ruleContext, {
        plans,
        call: async <T>(options: CallOptions<T>): Promise<LlmResult<T>> => {
          call += 1;
          const data = (options.stage === 'planner' ? block : approved) as T;
          return { data, modelUsed: 'stub', attempts: 1, costCredits: 0, ledger: [] };
        },
      });

      expect(result.status).toBe('accepted');
      expect(result.iterations).toBe(1);
      expect(call).toBe(2);
      expect(written).toHaveLength(1);
    }
  );
});

/**
 * WHY this suite exists: raised by the independent test author for
 * src/planner/rules.ts, who noticed that `JOINT_LOADING` keys are hyphenated
 * (`lower-back`) while the muscle names inside them are spaced (`lower back`),
 * and that nothing checked either against the real catalogue.
 *
 * Both happen to be right today. The failure mode is that a typo here matches
 * nothing and the rule silently stops protecting that joint — no error, no
 * finding, just a plan that loads an injured back. The rules' own tests cannot
 * catch it, because they supply their own candidates.
 */
describe('injury vocabulary against the real catalogue', () => {
  const CANDIDATES = CASES.flatMap((c) => c.candidates);

  it.each(Object.keys(JOINT_LOADING))('%s matches at least one real exercise', (joint) => {
    const matched = CANDIDATES.filter((c) => loadsAnyInjured(c, [joint]));
    expect(matched.length).toBeGreaterThan(0);
  });

  it.each(Object.entries(JOINT_LOADING))(
    '%s names only muscles and patterns the catalogue actually uses',
    (_joint, loading) => {
      // Against the whole catalogue, not one user's candidates — see
      // catalogueVocabulary for why those differ.
      const { muscles, patterns } = catalogueVocabulary();

      for (const muscle of loading.muscles) expect(muscles).toContain(muscle);
      for (const pattern of loading.patterns) expect(patterns).toContain(pattern);
    }
  );
});
