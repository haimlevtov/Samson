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
import {
  CRITIC_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  MAX_PLAN_ITERATIONS,
  PLANNER_MAX_TOKENS,
  PLANNER_TIMEOUT_MS,
} from '../llm/config';
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
 * WHY the whole input hashes cleanly now: rejections used to live on
 * `PlannerInput` and had to be stripped here, because they change on every
 * iteration while the user, goal and history stay the same. ADR 0008 moved them
 * out of the input entirely, so what remains is already the question — and the
 * hash is unchanged for an unchanged question, which keeps it comparable with
 * runs recorded before that change.
 */
function hashInput(input: PlannerInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);
}

/**
 * Identity of a *problem*, not of a report of one.
 *
 * WHY slug and week and not the detail string: the detail embeds measured
 * numbers, so a planner that moves from 32 kg to 31 kg against a 30 kg ceiling
 * would produce a different sentence for the same unfixed mistake and reset its
 * own repeat count. The pair that must change for the problem to be fixed is
 * the rule and the thing it fired on.
 */
function rejectionKey(r: Rejection): string {
  return [r.source, r.code, r.constraint?.exerciseSlug ?? '', r.weekNumber ?? ''].join('|');
}

/** Carries each finding's consecutive-occurrence count forward — ADR 0008 §4. */
function withRepeats(fresh: Rejection[], priorCounts: ReadonlyMap<string, number>): Rejection[] {
  return fresh.map((r) => ({ ...r, repeated: (priorCounts.get(rejectionKey(r)) ?? 0) + 1 }));
}

function countsOf(rejections: readonly Rejection[]): Map<string, number> {
  // Only this iteration's keys survive, so a finding the planner actually fixed
  // drops back to zero instead of being reported as repeated forever.
  return new Map(rejections.map((r) => [rejectionKey(r), r.repeated]));
}

function fromRules(findings: RuleFinding[]): Rejection[] {
  return findings.map((f) => ({
    source: 'rules' as const,
    code: f.code,
    detail: f.detail,
    weekNumber: f.weekNumber,
    constraint: f.constraint,
    // Replaced by withRepeats before this leaves the iteration.
    repeated: 1,
  }));
}

/**
 * How much of a run a caller can afford — ADR 0027.
 *
 * WHY a parameter rather than lower constants: `MAX_PLAN_ITERATIONS` and
 * `PLANNER_TIMEOUT_MS` are right for `npm run eval:planner`, which has no
 * function ceiling and whose whole job is finding out what the planner can do.
 * Lowering them globally would make a GRADED output worse in order to fit a
 * surface the eval does not run on. Omit this and nothing changes.
 */
export interface PlanBudget {
  /** Ceiling on planner+critic rounds. Defaults to `MAX_PLAN_ITERATIONS`. */
  maxIterations?: number;
  /**
   * Wall-clock milliseconds for the WHOLE run, from the moment it starts.
   *
   * WHY the whole run rather than per call: a serverless ceiling applies to the
   * sum, and each call's own timeout is blind to what the previous ones spent.
   * One iteration at the configured timeouts is 180s against a 60s ceiling, so
   * capping calls individually would still be killed mid-generation — and a
   * killed function writes no ledger row and renders no state.
   */
  deadlineMs?: number;
}

/**
 * Below this, a call is not worth starting: the model cannot produce a block in
 * it, and spending the request means paying for a timeout that was predictable.
 * The run finishes as `failed` with a reason instead.
 */
const MIN_USEFUL_CALL_MS = 5_000;

export async function generatePlan(
  userId: string,
  input: PlannerInput,
  context: RuleContext,
  deps: PlannerDeps,
  budget: PlanBudget = {}
): Promise<PlanRunResult> {
  const startedAt = Date.now();
  const maxIterations = budget.maxIterations ?? MAX_PLAN_ITERATIONS;

  /**
   * What one call may have: its own default, or whatever is left of the run,
   * whichever is smaller. `null` means there is not enough left to try.
   */
  const allowance = (preferred: number): number | null => {
    if (budget.deadlineMs === undefined) return preferred;
    const left = budget.deadlineMs - (Date.now() - startedAt);
    return left < MIN_USEFUL_CALL_MS ? null : Math.min(preferred, left);
  };

  /** WHY a sentence rather than a code: it is rendered, and ADR 0027 §4 requires
   *  every terminal state to say something. */
  const OUT_OF_TIME = 'the plan did not finish inside the time this page has';

  const inputHash = hashInput(input);
  const rejections: Rejection[] = [];
  const modelsUsed: (string | null)[] = [];
  let costCredits = 0;
  let iterations = 0;
  let lastSource: Rejection['source'] | null = null;

  // What the NEXT attempt is corrected with — this iteration's findings only,
  // not the union of every iteration's. ADR 0008: the union grew the prompt on
  // exactly the attempts that were already the most expensive, and told the
  // planner nothing about which problems were still live.
  let current: Rejection[] = [];
  let priorCounts = new Map<string, number>();

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

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    iterations = iteration;

    // Escalate rather than repeat — ADR 0004. Asking the same model the same
    // question a third time mostly buys a third copy of the same answer.
    const escalating = iteration === maxIterations && rejections.length > 0;

    const plannerMs = allowance(PLANNER_TIMEOUT_MS);
    if (plannerMs === null) return finish('failed', null, OUT_OF_TIME);

    let block: TrainingBlock;
    try {
      const planned = await deps.call({
        userId,
        stage: 'planner',
        schema: trainingBlockSchema,
        schemaName: 'training_block',
        system: PLANNER_SYSTEM,
        // INVARIANT: corrections are trusted text and travel OUTSIDE the fence
        //            — ADR 0008. Putting them back inside the payload is the
        //            bug this loop was fixed for: the safety preamble tells the
        //            model never to obey anything fenced, and it obeys that.
        messages: [{ role: 'user', content: plannerUserMessage(input, current, iteration) }],
        maxTokens: PLANNER_MAX_TOKENS,
        timeoutMs: plannerMs,
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
      current = withRepeats(fromRules(findings), priorCounts);
      priorCounts = countsOf(current);
      // `rejections` still accumulates everything, because the run record is a
      // measurement and must not lose the attempts nobody corrected on.
      rejections.push(...current);
      lastSource = 'rules';
      continue;
    }

    // ---- Judgement, on a block that has already passed the arithmetic ----
    /*
     * The critic gets an allowance too, and it is the half that would otherwise
     * blow the ceiling: it runs on DEFAULT_TIMEOUT_MS (60s), which on its own is
     * the whole budget of a serverless function — so a planner call that used
     * most of the deadline would be followed by a critic call that could not
     * finish inside what remained. ADR 0027 §1.
     *
     * A block that passed the rules and ran out of time before the critic is
     * NOT accepted. The critic is the second opinion the whole pipeline is built
     * around (CLAUDE.md, architecture), and a block no second model looked at is
     * not a plan this project will hand to somebody's body.
     */
    const criticMs = allowance(DEFAULT_TIMEOUT_MS);
    if (criticMs === null) return finish('failed', null, OUT_OF_TIME);

    let approved: boolean;
    try {
      const verdict = await deps.call({
        userId,
        stage: 'critic',
        schema: criticVerdictSchema,
        schemaName: 'critic_verdict',
        system: CRITIC_SYSTEM,
        messages: [{ role: 'user', content: criticUserMessage(input, block) }],
        maxTokens: CRITIC_MAX_TOKENS,
        timeoutMs: criticMs,
      });
      costCredits += verdict.costCredits;
      modelsUsed.push(verdict.modelUsed);
      approved = verdict.data.approved;

      if (!approved) {
        current = withRepeats(
          verdict.data.reasons.map((r) => ({
            source: 'critic' as const,
            code: r.code,
            detail: r.detail,
            weekNumber: r.week_number,
            // No constraint: the critic judges, it does not measure. Its detail
            // is model-authored and stays fenced — ADR 0008 §2.
            constraint: null,
            repeated: 1,
          })),
          priorCounts
        );
        priorCounts = countsOf(current);
        rejections.push(...current);
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
