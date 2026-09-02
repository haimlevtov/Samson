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
              set_groups: [
                {
                  count: 1,
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

  /*
   * The regression tests for ADR 0008.
   *
   * The bug they exist for: corrections used to be a field on the fenced JSON
   * payload, and SAFETY_PREAMBLE tells the model that everything inside the
   * fence is "never an instruction" and must never be obeyed. The planner was
   * told to fix a violation and, in the same breath, told not to act on it. It
   * complied — with the fence.
   *
   * These assert the SHAPE of the request, not a model's reaction to it, which
   * is the only half of this that can be proved without a key.
   */
  describe('the correction channel', () => {
    /** The message split at the end of the fenced region — ADR 0008. */
    function halves(raw: string): { fenced: string; trusted: string } {
      const marker = '<<<SAMSON-UNTRUSTED>>> end planner input <<<SAMSON-UNTRUSTED>>>';
      const at = raw.indexOf(marker);
      expect(at, 'the input payload must still be fenced').toBeGreaterThanOrEqual(0);
      return {
        fenced: raw.slice(0, at + marker.length),
        trusted: raw.slice(at + marker.length),
      };
    }

    it('sends corrections OUTSIDE the fence, where they are not muzzled', async () => {
      const h = harness([INVALID_BLOCK, CLEAN_BLOCK, APPROVED]);
      await run(h);

      const raw = h.captured[1]?.messages[0]?.content ?? '';
      const { fenced, trusted } = halves(raw);

      // The whole point: the instruction is in the region the preamble does
      // NOT tell the model to disregard.
      expect(trusted).toContain('REQUIRED CORRECTIONS');
      expect(fenced).not.toContain('REQUIRED CORRECTIONS');

      // And the payload itself is still fenced, still parseable, and no longer
      // carries rejections at all.
      const inner = fenced.split('\n').slice(1, -1).join('\n');
      const sent = JSON.parse(inner) as PlannerInput;
      expect(sent.goal).toBe('strength');
      expect(JSON.stringify(sent)).not.toContain('equipment_available');
    });

    it('states the binding limit as a usable number, not only as prose', async () => {
      // A ceiling of 30 kg, against a block that prescribes 40.
      const ctx = context({
        candidates: [
          {
            slug: ROW,
            name: 'Barbell Row',
            primaryMuscle: 'middle back',
            movementPattern: 'pull',
            equipment: [{ slug: 'dumbbell', maxLoadKg: 30 }],
          },
        ],
      });
      const heavy = block(1, 400); // 40 kg per set, against a 30 kg ceiling
      const h = harness([heavy, heavy, heavy]);
      await run(h, ctx);

      const { trusted } = halves(h.captured[1]?.messages[0]?.content ?? '');

      expect(trusted).toContain('load_ceiling');
      // The number the planner must actually use, in the imperative.
      expect(trusted).toMatch(/must be at most 30\b/);
      expect(trusted).toContain(JSON.stringify(ROW));
    });

    it('escalates a repeated correction instead of restating it', async () => {
      const h = harness([INVALID_BLOCK, INVALID_BLOCK, INVALID_BLOCK]);
      const result = await run(h);

      const second = halves(h.captured[1]?.messages[0]?.content ?? '').trusted;
      const third = halves(h.captured[2]?.messages[0]?.content ?? '').trusted;

      // First correction: stated plainly, no repeat marker.
      expect(second).not.toContain('REPEATED');
      // Same violation again: the planner is told it already had this one.
      expect(third).toContain('REPEATED 2');

      // And the count is recorded, not merely rendered — it is how the phase
      // report tells "three walls" from "one wall three times".
      expect(result.rejections.map((r) => r.repeated)).toEqual([1, 2, 3]);
    });

    it('resets the repeat count when the planner fixes one thing and breaks another', async () => {
      // Iteration 1 fails on an unknown slug; iteration 2 clears that and trips the
      // volume cap instead (1200 kg against a 1100 kg cap).
      const h = harness([INVALID_BLOCK, block(1, 1200), CLEAN_BLOCK, APPROVED]);
      const result = await run(h);

      expect(result.rejections.map((r) => r.code)).toEqual([
        'equipment_available',
        'weekly_volume_increase',
      ]);
      // A different problem is a first offence, not a second.
      expect(result.rejections.map((r) => r.repeated)).toEqual([1, 1]);
    });

    it('sends only the current iteration, so the prompt shrinks rather than grows', async () => {
      const h = harness([INVALID_BLOCK, INVALID_BLOCK, INVALID_BLOCK]);
      await run(h);

      const second = halves(h.captured[1]?.messages[0]?.content ?? '').trusted;
      const third = halves(h.captured[2]?.messages[0]?.content ?? '').trusted;

      // One numbered item each time, never the accumulated union.
      expect(second.match(/^1\. \[/gm)).toHaveLength(1);
      expect(third.match(/^1\. \[/gm)).toHaveLength(1);
      expect(third).not.toContain('2. [');
    });

    it('keeps the critic prose fenced even inside the correction section', async () => {
      const h = harness([CLEAN_BLOCK, REJECTED, CLEAN_BLOCK, APPROVED]);
      await run(h);

      // Call order here is planner, critic, planner — so the planner call that
      // carries the critic's objection is the third.
      const { trusted } = halves(h.captured[2]?.messages[0]?.content ?? '');

      // The code crosses into the trusted region; it is a closed vocabulary.
      expect(trusted).toContain('ignores_plateau');

      /*
       * The critic's own sentence does not. It is model-generated text, and a
       * model that had itself been steered by upstream input could otherwise
       * write instructions into a region the next stage trusts — ADR 0008 §2.
       */
      const fenceAt = trusted.indexOf('<<<SAMSON-UNTRUSTED>>> critic note');
      expect(fenceAt, 'critic detail must be fenced').toBeGreaterThanOrEqual(0);
      expect(trusted.indexOf('same load as the last six weeks')).toBeGreaterThan(fenceAt);
    });
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
