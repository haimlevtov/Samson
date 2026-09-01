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
import { checkRules, JOINT_LOADING } from '../../src/planner/rules';
import { tonnageByWeek } from '../../src/metrics/tonnage';
import { startOfWeek } from '../../src/metrics/dates';
import {
  plannerInputSchema,
  trainingBlockSchema,
  type CriticVerdict,
} from '../../src/planner/schema';
import type { CallOptions, LlmResult } from '../../src/llm/types';
import type { PlanRunInsert, PlanRunStore } from '../../src/planner/types';
import { catalogueVocabulary, goldenCases, GOLDEN_AS_OF, type GoldenCase } from '../planner/golden';
import { compliantBlock, loadsAnyInjured, naiveBlock } from '../planner/stub-planner';

const CASES = goldenCases();

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
      const block = compliantBlock(ruleContext, golden.blockWeeks, golden.daysPerWeek);

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
        .flatMap((e) => e.set_groups)
        .reduce((sum, g) => sum + (g.weight_kg ?? 0) * g.reps * g.count, 0);
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
      const naive = naiveBlock(ruleContext, golden.blockWeeks, golden.daysPerWeek);

      const findings = checkRules(naive, ruleContext);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.map((f) => f.code)).toContain('equipment_available');
    }
  );

  it.each(CASES.map((c) => [c.id, c] as const))(
    '%s — the loop accepts a compliant block within the retry cap',
    async (_id, golden) => {
      const { plannerInput, ruleContext } = contextFor(golden);
      const block = compliantBlock(ruleContext, golden.blockWeeks, golden.daysPerWeek);
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

/**
 * The check that would have caught the baseline bug, and did not exist.
 *
 * `compliantBlock` sizes its weeks FROM `ruleContext.baselineWeeklyTonnageKg`,
 * so when that number was wrong the stub shrank with it and every assertion
 * above still passed. Thirty green cases offline, and a live run rejected all
 * thirty.
 *
 * This asserts the property that was actually violated, built from the
 * archetype's OWN logged history and nothing derived from the caps: a week of
 * the training this person already does must be allowed. A guard that forbids
 * someone's current routine is not protecting them from a spike — it is
 * refusing to let them train.
 *
 * AI-NOTE: do not rewrite this to size the block from ruleContext. Reading the
 *          number under test is exactly what hid the bug the first time.
 */
describe('the caps admit what the user already does', () => {
  const ONE_PER_ARCHETYPE = CASES.filter((c) => c.id.endsWith('/strength-3d'));

  it.each(ONE_PER_ARCHETYPE.map((c) => [c.archetype.key, c] as const))(
    '%s — a week matching their own recent training passes every rule',
    (_key, golden) => {
      const { ruleContext } = contextFor(golden);

      // Their median COMPLETE week, computed here from the log.
      const weekly = [...tonnageByWeek(golden.sets).entries()]
        .filter(([week]) => week < startOfWeek(GOLDEN_AS_OF))
        .map(([, tonnage]) => tonnage)
        .sort((a, b) => a - b);
      const typical = weekly[Math.floor(weekly.length / 2)] ?? 0;
      expect(typical).toBeGreaterThan(0);

      const usable = ruleContext.candidates.filter(
        (c) => !loadsAnyInjured(c, ruleContext.injuredJoints)
      );
      expect(usable.length).toBeGreaterThan(0);

      /*
       * Spread over several exercises so no group exceeds the schema's cap of
       * 20 sets, and respect each candidate's own ceiling — the home-gym
       * dumbbells stop at 30 kg, and a fixture ignoring that would fail
       * load_ceiling and say nothing about the volume rule under test.
       */
      const reps = 10;
      const exercises = [];
      let remaining = typical;

      for (const candidate of usable.slice(0, 8)) {
        if (remaining <= 0) break;
        const caps = candidate.equipment
          .map((e) => e.maxLoadKg)
          .filter((c): c is number => c !== null);
        const weight = caps.length > 0 ? Math.min(20, Math.min(...caps)) : 20;
        const perSet = weight * reps;
        const count = Math.min(20, Math.max(1, Math.round(remaining / perSet)));
        remaining -= count * perSet;
        exercises.push({
          exercise_slug: candidate.slug,
          set_groups: [{ count, reps, weight_kg: weight, rpe: 7, rest_seconds: 120 }],
        });
      }

      const block = {
        rationale: 'a week of what they already do',
        weeks: [
          {
            week_number: 1,
            is_deload: false,
            sessions: [{ day_index: 0, focus: 'full body', exercises }],
          },
        ],
      };

      expect(trainingBlockSchema.safeParse(block).success).toBe(true);
      expect(checkRules(block, ruleContext)).toEqual([]);
    }
  );
});
