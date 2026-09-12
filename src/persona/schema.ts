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

/**
 * The five shipped personas. Rows in `personas`, not values in code —
 * CLAUDE.md #7. This list is a mirror of the migrations, never the source: the
 * database decides which personas exist, and `tests/db/personas.test.ts`
 * asserts the two agree.
 *
 * AI-NOTE: that test is what makes this constant worth having. Before it, the
 *          skill said to keep this in step because "it is what tests and
 *          fixtures enumerate" and nothing enumerated it at all — it was
 *          referenced only by its own declaration and a doc comment, so it
 *          could drift from the rows indefinitely without anything noticing.
 */
export const SHIPPED_PERSONA_SLUGS = [
  'rival',
  'analyst',
  'old-master',
  'sergeant',
  'physio',
  'austrian',
] as const;

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

/**
 * Exactly the fields the delivery stage reads, from any wider row.
 *
 * WHY a pick and not the row passed through: the picker's `ListedPersona`
 * carries `sampleLine`, which a user can write on their own persona row, and
 * delivery never reads it. Passing the row through was safe only while the
 * prompt builder names fields one at a time; a later edit that spread the
 * persona into a message would have carried the line outside the fence —
 * CLAUDE.md #11, ADR 0006's 2026-09-11 amendment. Picking keeps THE LINE, and
 * any field a reader type gains later, out of delivery altogether.
 *
 * It does not make the fields it keeps trusted: `name`, `systemPrompt` and
 * `bannedPhrases` are writable on a user's own row as well. src/persona/prompts.ts
 * fences `systemPrompt`, and cleans `name` (the fence label) and
 * `bannedPhrases` (outside the fence).
 */
export function asPersona(row: Persona): Persona {
  return {
    slug: row.slug,
    name: row.name,
    systemPrompt: row.systemPrompt,
    intensity: row.intensity,
    humorLevel: row.humorLevel,
    bannedPhrases: row.bannedPhrases,
  };
}
