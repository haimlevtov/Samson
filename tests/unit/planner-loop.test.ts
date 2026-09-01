/**
 * The evaluator-optimizer loop, proved with no key, no network and no database.
 *
 * The acceptance criterion this file exists for: "a plan that passes the rules
 * but is rejected by the critic is recorded as such — the two rejection sources
 * are never conflated in the ledger" (PLAN.md phase 2).
 *
 * WHY a scripted model rather than a real one: the behaviour under test is the
 * loop's, not the model's — how many iterations run, which gate rejected, what
 * gets written down, when it escalates. A real model would make every one of
 * those non-deterministic and prove none of them.
 */
import { describe, expect, it } from 'vitest';
import { generatePlan } from '../../src/planner/loop';
import type { RuleContext } from '../../src/planner/rules';
import type { CriticVerdict, PlannerInput, TrainingBlock } from '../../src/planner/schema';
import type { PlanRunInsert, PlanRunStore, PlannerDeps } from '../../src/planner/types';
import type { CallOptions, LlmResult } from '../../src/llm/types';
import { BudgetExceededError, LlmCallFailedError } from '../../src/llm/types';
import { ESCALATION_MODELS } from '../../src/llm/models';
import { MAX_PLAN_ITERATIONS } from '../../src/llm/config';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SQUAT = 'barbell-back-squat';
const ROW = 'barbell-row';

function context(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    candidates: [
      {
        slug: SQUAT,
        name: 'Barbell Back Squat',
        primaryMuscle: 'quadriceps',
        movementPattern: 'squat',
        equipment: [{ slug: 'barbell', maxLoadKg: null }],
      },
      {
        slug: ROW,
        name: 'Barbell Row',
        primaryMuscle: 'middle back',
        movementPattern: 'pull',
        equipment: [{ slug: 'barbell', maxLoadKg: null }],
      },
    ],
    injuredJoints: [],
    baselineWeeklyTonnageKg: 1000,
    chronicWeeklyTonnageKg: 1000,
    ...overrides,
  };
}

/** A block of `weeks` weeks, each prescribing exactly `tonnage` kg of rows. */
function block(weeks: number, tonnagePerWeek: number, slug = ROW): TrainingBlock {
  return {
    rationale: 'test block',
    weeks: Array.from({ length: weeks }, (_, i) => ({
      week_number: i + 1,
      // Week 5 deloads so deload_cadence is satisfied for longer blocks.
      is_deload: i + 1 === 5,
      sessions: [
        {
          day_index: 0,
          focus: 'full body',
          exercises: [
            {
              exercise_slug: slug,
              sets: [
                {
                  set_index: 0,
                  weight_kg: tonnagePerWeek / 10,
                  reps: 10,
                  rpe: 8,
                  rest_seconds: 120,
                },
              ],
            },
          ],
        },
      ],
    })),
  };
}

const CLEAN_BLOCK = block(4, 1000);
/** Breaks equipment_available: the slug is not in the candidate list. */
const INVALID_BLOCK = block(4, 1000, 'exercise-that-does-not-exist');

const APPROVED: CriticVerdict = { approved: true, reasons: [] };
const REJECTED: CriticVerdict = {
  approved: false,
  reasons: [
    {
      code: 'ignores_plateau',
      detail: 'same load as the last six weeks',
      severity: 'block',
      week_number: 2,
    },
  ],
};

function plannerInput(): PlannerInput {
  return {
    goal: 'strength',
    days_per_week: 3,
    block_weeks: 4,
    injured_joints: [],
    metrics: {
      as_of: '2026-09-01',
      weeks_of_history: 12,
      sessions_per_week: 3,
      adherence_rate: 0.9,
      weekly_tonnage_kg: [{ week_start: '2026-08-24', tonnage_kg: 1000 }],
      acwr: 1.0,
      acwr_band: 'sweet-spot',
      best_e1rm_kg: [{ exercise_slug: SQUAT, e1rm_kg: 100 }],
    },
    candidates: [],
    prior_rejections: [],
  };
}

// ---------------------------------------------------------------------------
// A scripted model and a capturing store
// ---------------------------------------------------------------------------

type Scripted = TrainingBlock | CriticVerdict | Error;

interface Harness {
  deps: PlannerDeps;
  captured: CallOptions<unknown>[];
  written: PlanRunInsert[];
}

/**
 * Responses are consumed in call order. A block answers the planner, a verdict
 * answers the critic, an Error is thrown from whichever call reaches it — which
 * is how the budget and transport failure paths are exercised.
 */
function harness(script: Scripted[]): Harness {
  const captured: CallOptions<unknown>[] = [];
  const written: PlanRunInsert[] = [];
  let next = 0;

  const call = async <T>(options: CallOptions<T>): Promise<LlmResult<T>> => {
    captured.push(options as CallOptions<unknown>);
    const response = script[next++];
    if (response === undefined) throw new Error(`script exhausted at call ${next}`);
    if (response instanceof Error) throw response;
    return {
      data: response as T,
      modelUsed: options.models?.[0] ?? `stub-${options.stage}`,
      attempts: 1,
      costCredits: 0.001,
      ledger: [],
    };
  };

  const plans: PlanRunStore = {
    async insertPlanRun(row) {
      written.push(row);
    },
  };

  return { deps: { call, plans }, captured, written };
}

const run = (h: Harness, ctx: RuleContext = context()) =>
  generatePlan('user-1', plannerInput(), ctx, h.deps);

// ---------------------------------------------------------------------------

describe('generatePlan', () => {
  it('accepts a block that passes the rules and the critic on the first pass', async () => {
    const h = harness([CLEAN_BLOCK, APPROVED]);
    const result = await run(h);

    expect(result.status).toBe('accepted');
    expect(result.iterations).toBe(1);
    expect(result.rejections).toEqual([]);
    expect(result.block).toEqual(CLEAN_BLOCK);
  });

  it('runs the rules before the critic, and does not call the critic on a rule failure', async () => {
    // Only one scripted response: if the critic were called, the script would
    // be exhausted and the test would fail with that error instead.
    const h = harness([INVALID_BLOCK, CLEAN_BLOCK, APPROVED]);
    const result = await run(h);

    expect(result.status).toBe('accepted');
    expect(result.iterations).toBe(2);
    // planner, planner, critic — never planner, critic, planner.
    expect(h.captured.map((c) => c.stage)).toEqual(['planner', 'planner', 'critic']);
  });

  it('tags rule rejections as rules and critic rejections as critic, never the reverse', async () => {
    // Iteration 1 fails the rules. Iteration 2 passes them and the critic
    // rejects. Iteration 3 passes both.
    const h = harness([INVALID_BLOCK, CLEAN_BLOCK, REJECTED, CLEAN_BLOCK, APPROVED]);
    const result = await run(h);

    expect(result.status).toBe('accepted');

    const rules = result.rejections.filter((r) => r.source === 'rules');
    const critic = result.rejections.filter((r) => r.source === 'critic');

    expect(rules).not.toHaveLength(0);
    expect(critic).not.toHaveLength(0);
    expect(rules.length + critic.length).toBe(result.rejections.length);

    // The rule finding kept its own code and did not acquire a critic vocabulary
    // code, and vice versa — this is the conflation the criterion forbids.
    expect(rules.every((r) => r.code === 'equipment_available')).toBe(true);
    expect(critic.every((r) => r.code === 'ignores_plateau')).toBe(true);
  });

  it('feeds prior rejections back to the planner as structured data', async () => {
    const h = harness([INVALID_BLOCK, CLEAN_BLOCK, APPROVED]);
    await run(h);

    const retry = h.captured[1];
    expect(retry).toBeDefined();
    const sent = JSON.parse(retry?.messages[0]?.content ?? '{}') as PlannerInput;

    expect(sent.prior_rejections).toHaveLength(1);
    expect(sent.prior_rejections[0]).toMatchObject({
      source: 'rules',
      code: 'equipment_available',
    });
    // ADR 0004: structure, not prose. The receiving stage reads a field.
    expect(typeof sent.prior_rejections[0]?.detail).toBe('string');
  });

  it('escalates the model on the final iteration rather than repeating', async () => {
    const h = harness([INVALID_BLOCK, INVALID_BLOCK, INVALID_BLOCK]);
    await run(h);

    const planners = h.captured.filter((c) => c.stage === 'planner');
    expect(planners).toHaveLength(MAX_PLAN_ITERATIONS);
    expect(planners[0]?.models).toBeUndefined();
    expect(planners[1]?.models).toBeUndefined();
    expect(planners[MAX_PLAN_ITERATIONS - 1]?.models).toEqual(ESCALATION_MODELS);
  });

  it('ends rejected_rules when arithmetic rejected every attempt', async () => {
    const h = harness([INVALID_BLOCK, INVALID_BLOCK, INVALID_BLOCK]);
    const result = await run(h);

    expect(result.status).toBe('rejected_rules');
    expect(result.iterations).toBe(MAX_PLAN_ITERATIONS);
    expect(result.block).toBeNull();
  });

  it('ends rejected_critic when the block cleared the rules and the critic held out', async () => {
    const h = harness([CLEAN_BLOCK, REJECTED, CLEAN_BLOCK, REJECTED, CLEAN_BLOCK, REJECTED]);
    const result = await run(h);

    expect(result.status).toBe('rejected_critic');
    expect(result.rejections.every((r) => r.source === 'critic')).toBe(true);
  });

  it('records a budget denial as failed, not as a rejection', async () => {
    const h = harness([new BudgetExceededError(0.6, 0.5)]);
    const result = await run(h);

    expect(result.status).toBe('failed');
    expect(result.rejections).toEqual([]);
    expect(result.error).toContain('budget');
  });

  it('records an exhausted call as failed', async () => {
    const h = harness([new LlmCallFailedError('planner call failed after 3 attempts', [])]);
    const result = await run(h);

    expect(result.status).toBe('failed');
    expect(result.block).toBeNull();
  });

  it('writes exactly one plan_runs row on every terminal path', async () => {
    const cases: Scripted[][] = [
      [CLEAN_BLOCK, APPROVED],
      [INVALID_BLOCK, INVALID_BLOCK, INVALID_BLOCK],
      [CLEAN_BLOCK, REJECTED, CLEAN_BLOCK, REJECTED, CLEAN_BLOCK, REJECTED],
      [new BudgetExceededError(1, 0.5)],
    ];

    for (const script of cases) {
      const h = harness(script);
      await run(h);
      expect(h.written).toHaveLength(1);
      expect(h.written[0]?.user_id).toBe('user-1');
    }
  });

  it('writes a block only when the run was accepted', async () => {
    // Mirrors the plan_runs_block_present_when_accepted check constraint, so a
    // violation surfaces here rather than as a Postgres error in production.
    const accepted = harness([CLEAN_BLOCK, APPROVED]);
    await run(accepted);
    expect(accepted.written[0]?.block).not.toBeNull();

    const failed = harness([INVALID_BLOCK, INVALID_BLOCK, INVALID_BLOCK]);
    await run(failed);
    expect(failed.written[0]?.block).toBeNull();
  });

  it('keeps the input hash stable across iterations, because the question did not change', async () => {
    const once = harness([CLEAN_BLOCK, APPROVED]);
    const twice = harness([INVALID_BLOCK, CLEAN_BLOCK, APPROVED]);

    const a = await run(once);
    const b = await run(twice);

    // Different attempt counts, same underlying question.
    expect(a.inputHash).toBe(b.inputHash);
  });

  it('sums cost across planner and critic calls alike', async () => {
    const h = harness([INVALID_BLOCK, CLEAN_BLOCK, APPROVED]);
    const result = await run(h);

    // Three calls at 0.001 each.
    expect(result.costCredits).toBeCloseTo(0.003, 6);
    expect(result.modelsUsed).toHaveLength(3);
  });
});
