/**
 * The evaluator-optimizer loop: planner produces, rules gate, critic judges,
 * planner revises. Coordination design in `docs/adr/0004-planner-critic.md`.
 *
 * INVARIANT: rules run before the critic and on every block — ADR 0004. The
 *            critic is never the last line of defence on anything numeric.
 * INVARIANT: the two rejection sources are never conflated — PLAN.md phase 2.
 *            Every recorded rejection carries `source`.
 *
 * All I/O is injected through `PlannerDeps`, so this file — the part of phase 2
 * whose behaviour actually needs proving — runs in the unit suite with no key,
 * no network and no database.
 */
import { createHash } from 'node:crypto';
import { CRITIC_MAX_TOKENS, MAX_PLAN_ITERATIONS, PLANNER_MAX_TOKENS } from '../llm/config';
import { ESCALATION_MODELS } from '../llm/models';
import { SafetyBlockedError } from '../llm/safety';
import { BudgetExceededError, LlmCallFailedError } from '../llm/types';
import { CRITIC_SYSTEM, PLANNER_SYSTEM, criticUserMessage, plannerUserMessage } from './prompts';
import { checkRules, type RuleContext, type RuleFinding } from './rules';
import {
  criticVerdictSchema,
  trainingBlockSchema,
  type PlannerInput,
  type Rejection,
  type TrainingBlock,
} from './schema';
import type { PlanRunStatus, PlannerDeps } from './types';

export interface PlanRunResult {
  status: PlanRunStatus;
  block: TrainingBlock | null;
  iterations: number;
  rejections: Rejection[];
  /** Summed across every call the run made, planner and critic alike. */
  costCredits: number;
  /** In call order, so an escalation is visible as a change partway through. */
  modelsUsed: (string | null)[];
  inputHash: string;
  /** Present only when the run ended `failed`. */
  error: string | null;
}

/**
 * Identifies the *question*, not the attempt.
 *
 * WHY prior_rejections are excluded: they change on every iteration while the
 * user, goal and history stay the same. Hashing them would give each iteration
 * a different identity and make "how many runs asked this same question" —
 * the comparison prompt versions are measured by — unanswerable.
 */
function hashInput(input: PlannerInput): string {
  const { prior_rejections: _ignored, ...question } = input;
  return createHash('sha256').update(JSON.stringify(question)).digest('hex').slice(0, 32);
}

function fromRules(findings: RuleFinding[]): Rejection[] {
  return findings.map((f) => ({
    source: 'rules' as const,
    code: f.code,
    detail: f.detail,
    weekNumber: f.weekNumber,
  }));
}

export async function generatePlan(
  userId: string,
  input: PlannerInput,
  context: RuleContext,
  deps: PlannerDeps
): Promise<PlanRunResult> {
  const inputHash = hashInput(input);
  const rejections: Rejection[] = [];
  const modelsUsed: (string | null)[] = [];
  let costCredits = 0;
  let iterations = 0;
  let lastSource: Rejection['source'] | null = null;

  const finish = async (
    status: PlanRunStatus,
    block: TrainingBlock | null,
    error: string | null
  ): Promise<PlanRunResult> => {
    // INVARIANT: every run is recorded, accepted or not — the rejection counts
    //            in the phase report are a measurement only if the failures are
    //            written down as reliably as the successes.
    await deps.plans.insertPlanRun({
      user_id: userId,
      status,
      iterations: Math.max(1, iterations),
      block,
      rejections,
      input_hash: inputHash,
    });
    return { status, block, iterations, rejections, costCredits, modelsUsed, inputHash, error };
  };

  for (let iteration = 1; iteration <= MAX_PLAN_ITERATIONS; iteration++) {
    iterations = iteration;

    // Every rejection so far, as data. ADR 0004: handoffs carry structure —
    // the planner reads fields, it does not parse a sentence back into one.
    const attemptInput: PlannerInput = {
      ...input,
      prior_rejections: rejections.map((r) => ({
        source: r.source,
        code: r.code,
        detail: r.detail,
        week_number: r.weekNumber,
      })),
    };

    // Escalate rather than repeat — ADR 0004. Asking the same model the same
    // question a third time mostly buys a third copy of the same answer.
    const escalating = iteration === MAX_PLAN_ITERATIONS && rejections.length > 0;

    let block: TrainingBlock;
    try {
      const planned = await deps.call({
        userId,
        stage: 'planner',
        schema: trainingBlockSchema,
        schemaName: 'training_block',
        system: PLANNER_SYSTEM,
        messages: [{ role: 'user', content: plannerUserMessage(attemptInput) }],
        maxTokens: PLANNER_MAX_TOKENS,
        ...(escalating ? { models: ESCALATION_MODELS } : {}),
      });
      costCredits += planned.costCredits;
      modelsUsed.push(planned.modelUsed);
      block = planned.data;
    } catch (cause) {
      // A budget denial or an exhausted schema retry is not a rejected plan. It
      // is the run failing, and conflating the two would put transport noise in
      // the rejection statistics.
      // A content block is not a rejected plan either: nothing was judged, the
      // answer was refused before anyone read it — ADR 0005.
      if (
        cause instanceof BudgetExceededError ||
        cause instanceof LlmCallFailedError ||
        cause instanceof SafetyBlockedError
      ) {
        return finish('failed', null, cause.message);
      }
      throw cause;
    }

    // ---- Deterministic gate, always, regardless of what any model says ----
    const findings = checkRules(block, context);
    if (findings.length > 0) {
      rejections.push(...fromRules(findings));
      lastSource = 'rules';
      continue;
    }

    // ---- Judgement, on a block that has already passed the arithmetic ----
    let approved: boolean;
    try {
      const verdict = await deps.call({
        userId,
        stage: 'critic',
        schema: criticVerdictSchema,
        schemaName: 'critic_verdict',
        system: CRITIC_SYSTEM,
        messages: [{ role: 'user', content: criticUserMessage(attemptInput, block) }],
        maxTokens: CRITIC_MAX_TOKENS,
      });
      costCredits += verdict.costCredits;
      modelsUsed.push(verdict.modelUsed);
      approved = verdict.data.approved;

      if (!approved) {
        rejections.push(
          ...verdict.data.reasons.map((r) => ({
            source: 'critic' as const,
            code: r.code,
            detail: r.detail,
            weekNumber: r.week_number,
          }))
        );
        lastSource = 'critic';
      }
    } catch (cause) {
      if (
        cause instanceof BudgetExceededError ||
        cause instanceof LlmCallFailedError ||
        cause instanceof SafetyBlockedError
      ) {
        return finish('failed', null, cause.message);
      }
      throw cause;
    }

    if (approved) return finish('accepted', block, null);
  }

  // Out of iterations. The status names where the last attempt died, because
  // "arithmetic kept rejecting it" and "the critic kept rejecting it" describe
  // different problems and imply opposite next moves.
  const status: PlanRunStatus =
    lastSource === 'rules'
      ? 'rejected_rules'
      : lastSource === 'critic'
        ? 'rejected_critic'
        : 'exhausted';

  return finish(status, null, null);
}
