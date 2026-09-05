/**
 * What a persona is allowed to return.
 *
 * INVARIANT: the persona layer cannot alter any number in the plan it receives
 *            — PLAN.md phase 3, PRD §3, ADR 0006.
 *
 * WHY there is not a single numeric field below: the invariant is structural
 * before it is tested. The block the user sees is the same object the planner
 * produced and the critic approved; this is prose rendered beside it. There is
 * no field through which a changed number could travel.
 *
 * AI-NOTE: week notes are POSITIONAL — `week_notes[0]` belongs to the first
 *          week of the block. A `week_number` field would be a number the
 *          persona could get wrong, which is exactly what this shape exists to
 *          prevent. `deliver.ts` checks the lengths match.
 */
import { z } from 'zod';

export const deliveredPlanSchema = z.strictObject({
  /** One or two sentences to open on. */
  opening: z.string().min(1).max(400),
  /**
   * One note per week of the block, in block order. Never renumbered, never
   * reordered, never a different length — see the AI-NOTE above.
   */
  week_notes: z.array(z.string().min(1).max(600)).min(1).max(12),
  closing: z.string().min(1).max(400),
});
export type DeliveredPlan = z.infer<typeof deliveredPlanSchema>;

/** The three shipped personas. Rows in `personas`, not values in code — CLAUDE.md #7. */
export const SHIPPED_PERSONA_SLUGS = ['rival', 'analyst', 'old-master'] as const;

/**
 * The scale, least to most, as a tuple so it can be both a Zod enum and the
 * order below without being written twice.
 */
export const HUMOR_LEVELS = ['clean', 'cheeky', 'crude'] as const;

export type HumorLevel = (typeof HUMOR_LEVELS)[number];

/**
 * Ordered least to most, so both clamps are a `Math.min` over an index.
 * WHY ordered at all: `users.humor_max_level` is a ceiling, and a ceiling needs
 * a scale to be a ceiling on.
 */
export const HUMOR_ORDER: readonly HumorLevel[] = HUMOR_LEVELS;

/** One persona row, as the delivery stage needs it. */
export interface Persona {
  slug: string;
  name: string;
  /**
   * INVARIANT: this is a database column, therefore data — ADR 0006. It is
   *            fenced into the per-call message, never concatenated into the
   *            stage's system prompt.
   */
  systemPrompt: string;
  intensity: number;
  humorLevel: HumorLevel;
  bannedPhrases: string[];
}
