/**
 * What the user is asked for before a plan can be generated — ADR 0027.
 *
 * The four fields of `ContextInput` the application cannot read for itself. The
 * other four — `asOf`, `workouts`, `sets`, `candidates` — it already has.
 *
 * INVARIANT: equipment is NOT here. Filtering by it happens in SQL before the
 *            model sees anything (CLAUDE.md #5), so it arrives as pre-filtered
 *            `candidates` rather than as an answer. Asking about it is a Settings
 *            feature, not a planner input — the rework plan says so.
 *
 * Separate from `schema.ts` on purpose: that file is the contract with the
 * MODEL, validated on the way out and back. This is the contract with a form,
 * validated on the way in. They share a goal enum and nothing else.
 */
import { z } from 'zod';

import { WEB_PLAN_MAX_BLOCK_WEEKS } from '../llm/config';
import { JOINT_LOADING } from './rules';
import { trainingGoalSchema } from './schema';

/**
 * The joints a user may report, and the only ones that mean anything.
 *
 * INVARIANT: derived from `JOINT_LOADING`, never listed again. `loadsJoint`
 *            returns false for a joint it does not know, deliberately — a stray
 *            profile value must not fail every plan a user gets — which means a
 *            typo here would silently protect nothing. A control offering only
 *            these cannot produce one.
 */
export const REPORTABLE_JOINTS = Object.keys(JOINT_LOADING) as [string, ...string[]];

/**
 * How each joint is offered, in the user's words rather than the catalogue's.
 *
 * `Record<string, string>` with a runtime check below rather than a mapped type:
 * `REPORTABLE_JOINTS` is derived from an object's keys, so TypeScript sees
 * `string[]` and cannot make the exhaustiveness a compile error. The test asserts
 * it instead.
 */
export const JOINT_LABEL: Record<string, string> = {
  knee: 'Knee',
  hip: 'Hip',
  'lower-back': 'Lower back',
  shoulder: 'Shoulder',
  elbow: 'Elbow',
  wrist: 'Wrist',
  ankle: 'Ankle',
};

/**
 * How each goal is offered. Same reasoning, same test.
 *
 * "Return to training" is the one worth wording carefully: it is the goal for
 * somebody coming back, and the planner treats it as a reason to start below
 * where they left off rather than at it.
 */
export const GOAL_LABEL: Record<string, string> = {
  strength: 'Get stronger',
  hypertrophy: 'Build muscle',
  'general-fitness': 'General fitness',
  'return-to-training': 'Come back from a break',
};

/**
 * One request for a plan, as a form sends it.
 *
 * WHY `block_weeks` is capped at the WEB maximum rather than the schema's 12:
 * generation time scales with output tokens and nothing else here moves the
 * deadline, so this is the one question whose answer decides whether the run
 * fits inside a serverless function — ADR 0027 §3. A control that could ask for
 * eight weeks would be a control that could ask to be killed.
 *
 */
/**
 * The days-a-week a plan may be asked for, smallest first.
 *
 * Exported so the control and the schema cannot disagree — FOUND IN REVIEW, it
 * was the one option list on the form typed out by hand while the goals, the
 * weeks and the joints were all derived.
 *
 * Tighter than the planner schema's 1–7: one day is not a block, and seven
 * leaves no rest day, which the rules reject anyway. The bound that produces an
 * ANSWERABLE request is tighter than the bound that produces a valid one.
 */
export const PLAN_DAYS_PER_WEEK = [2, 3, 4, 5, 6] as const;

const MIN_DAYS = PLAN_DAYS_PER_WEEK[0];
const MAX_DAYS = PLAN_DAYS_PER_WEEK[PLAN_DAYS_PER_WEEK.length - 1] as number;

export const planRequestSchema = z.strictObject({
  goal: trainingGoalSchema,
  days_per_week: z.coerce.number().int().min(MIN_DAYS).max(MAX_DAYS),
  block_weeks: z.coerce.number().int().min(1).max(WEB_PLAN_MAX_BLOCK_WEEKS),
  /**
   * Deduplicated, because a form can send a checkbox name twice and two copies
   * of `knee` would put the same joint in the prompt twice for nothing.
   */
  injured_joints: z
    .array(z.enum(REPORTABLE_JOINTS))
    .max(REPORTABLE_JOINTS.length)
    .transform((joints) => [...new Set(joints)]),
});

export type PlanRequest = z.infer<typeof planRequestSchema>;

/**
 * Reads a plan request out of form data.
 *
 * WHY here rather than in the action: the action is a `'use server'` module and
 * this is the one piece of it worth testing without a database or a request.
 * `getAll` because the joints are checkboxes sharing a name.
 */
export function planRequestFrom(form: {
  get(name: string): unknown;
  getAll(name: string): unknown[];
}): z.ZodSafeParseResult<PlanRequest> {
  return planRequestSchema.safeParse({
    goal: form.get('goal'),
    days_per_week: form.get('days_per_week'),
    block_weeks: form.get('block_weeks'),
    injured_joints: form.getAll('injured_joints').filter((v) => v !== ''),
  });
}
