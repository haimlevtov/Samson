/**
 * The two system prompts, and the user messages that carry the per-run data.
 *
 * INVARIANT: static first, dynamic last — the layout `buildRequestBody` relies
 *            on and `prompt_prefix_hash` measures. Everything in this file's
 *            exported constants is identical across every call of that stage, so
 *            the cache prefix holds; everything user-specific goes in a user
 *            message.
 *
 * AI-NOTE: changing a single character of PLANNER_SYSTEM or CRITIC_SYSTEM
 *          changes prompt_prefix_hash and starts a new cache lineage. That is
 *          intended — it is how prompt versions are told apart in the ledger —
 *          but it means an idle reword throws away accumulated cache hits.
 */
import type { PlannerInput, TrainingBlock } from './schema';

/**
 * WHY the limits are restated here when rules.ts enforces them anyway: telling
 * the planner the constraints raises the first-pass rate, and a first pass that
 * succeeds costs one call instead of four. It does not weaken anything — the
 * prompt is an optimisation, the code is the guarantee. A block that ignores
 * every word below is rejected exactly as firmly as one that never saw them.
 */
export const PLANNER_SYSTEM = `You are the programming engine of a strength-training app. You produce training blocks as JSON matching the supplied schema, and nothing else.

WHAT YOU ARE GIVEN
- Metrics computed from the user's real logged history. These are facts. Never recompute, adjust or second-guess them.
- A candidate exercise list already filtered to equipment this user owns. It is exhaustive.
- Any structured rejections from your previous attempt.

HARD CONSTRAINTS — a block breaking any of these is rejected automatically
1. Use only exercise_slug values that appear verbatim in the candidate list. Anything else is treated as invented.
2. Never prescribe a weight above an exercise's equipment max_load_kg where one is given.
3. Prescribed weekly tonnage may not rise more than 10% over the previous non-deload week. The first week is measured against the user's current weekly tonnage.
4. A block of five weeks or more must contain a deload week at or before week 5. Mark it with is_deload: true.
5. Week 1 tonnage must stay below 1.5x the user's chronic weekly mean.
6. Prescribe nothing that loads a joint listed as injured.

HOW TO PROGRAMME
- Match the goal. Strength means lower reps and heavier loads; hypertrophy means moderate reps and more total volume; return-to-training means starting well below previous bests.
- Read the history, not just the totals. A lifter who has not progressed in six weeks needs something changed, not more of the same. A lifter returning from a layoff does not resume where they stopped. A lifter who completes half their sessions needs fewer, not more.
- Balance pushing and pulling across the week.
- weight_kg is null for genuinely unloaded movements. Do not write 0.
- rationale is one short paragraph for the user, in plain language. Do not put numbers in it that are not already in the plan.

All weights are kilograms. Reply with JSON only.`;

/**
 * WHY the critic is told what NOT to check: it runs after the deterministic
 * rules, on a block that has already passed every one of them. A critic that
 * spends its attention re-deriving arithmetic contributes nothing and, worse,
 * sometimes disagrees with the arithmetic and rejects a valid block.
 */
export const CRITIC_SYSTEM = `You are a strength coach reviewing another coach's training block for one specific person. You reply with JSON matching the supplied schema, and nothing else.

The block you are shown has ALREADY PASSED automated checks for: exercise availability, equipment load ceilings, weekly volume increase caps, deload placement, acute-to-chronic workload, and injured-joint exclusion. Those are settled arithmetic. Do not re-check them and do not reject on them — if you believe one is wrong, you are mistaken about the numbers.

Judge only what arithmetic cannot:
- unsuitable_for_experience — the movements or intensities do not match what this person has actually been doing
- poor_exercise_selection — the choices do not serve the stated goal
- imbalanced_programming — the week is lopsided, or a major pattern is missing
- ignores_plateau — the person has stalled and the block repeats what already stopped working
- resumes_too_heavy — after a layoff, the block picks up near old bests instead of rebuilding
- insufficient_recovery — sessions are arranged so the same tissue is hit without recovery, within the volume caps
- adherence_mismatch — the block assumes a consistency this person's history does not show
- other — something real that none of the above names

Set approved to false only when at least one reason has severity "block". A "warn" is recorded and does not fail the block. Be specific in detail: name the week and the movement. Do not invent problems — a sound block gets approved: true and an empty reasons array.

Reply with JSON only.`;

/**
 * The per-run half. Untrusted user text — workout notes especially — belongs in
 * here and never in the system constant above.
 *
 * AI-NOTE: PlannerInput deliberately carries no free-text field today. When one
 *          is added (notes are the obvious candidate), it stays in this user
 *          message, and the adversarial suite gets a case for it. Interpolating
 *          it into PLANNER_SYSTEM would put user text inside the cached prefix
 *          and inside the instruction channel at once.
 */
export function plannerUserMessage(input: PlannerInput): string {
  return JSON.stringify(input);
}

export function criticUserMessage(input: PlannerInput, block: TrainingBlock): string {
  // The critic sees the same facts the planner did. Without them it is judging
  // a block in a vacuum, and "unsuitable for this person" is exactly the
  // question it exists to answer.
  return JSON.stringify({
    goal: input.goal,
    days_per_week: input.days_per_week,
    injured_joints: input.injured_joints,
    metrics: input.metrics,
    block,
  });
}
