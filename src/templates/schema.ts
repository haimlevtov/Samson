/**
 * The template contract, as Zod.
 *
 * INVARIANT: Zod schemas are the single source of truth — CLAUDE.md
 *            conventions. TS types below are inferred, never hand-written
 *            alongside, and the same schema validates the browser's payload and
 *            the coach import.
 *
 * Contract: docs/specs/workout-templates.md §2.
 */
import { z } from 'zod';

export const TEMPLATE_NAME_MAX = 80;

/**
 * WHY 32 and not a rounder number: the planner's own ceiling is 8 exercises of
 * 4 set groups (src/planner/schema.ts), so 32 is the largest session it can
 * emit. A lower cap here would let a coach import fail a bound that the
 * planner's rules and the safety critic had already passed, which would look
 * like a broken feature and would in fact be a broken constant.
 */
export const MAX_TEMPLATE_ITEMS = 32;

export const templateSourceSchema = z.enum(['user', 'coach']);
export type TemplateSource = z.infer<typeof templateSourceSchema>;

/**
 * One prescribed set group — ADR 0007's unit, kept identical on purpose so a
 * coach import is a copy rather than a translation.
 *
 * INVARIANT: kilograms and seconds — CLAUDE.md #8. A null `weightKg` is
 *            bodyweight, which is the absence of external load rather than a
 *            load of zero; `src/metrics/tonnage.ts` draws the same line.
 */
export const templateItemDraftSchema = z.strictObject({
  exerciseId: z.uuid(),
  setCount: z.int().min(1).max(20),
  reps: z.int().min(1).max(50),
  weightKg: z.number().min(0).max(500).nullable(),
  rpe: z.number().min(1).max(10).nullable(),
  restSeconds: z.int().min(0).max(900).nullable(),
});
export type TemplateItemDraft = z.infer<typeof templateItemDraftSchema>;

/**
 * A whole template, before it has an id.
 *
 * AI-NOTE: `notes` is untrusted free text with the same standing as
 *          `workouts.notes` — CLAUDE.md #11. If it ever reaches a prompt it
 *          goes in `messages`, fenced, never in `system`.
 */
export const templateDraftSchema = z.strictObject({
  name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX),
  source: templateSourceSchema,
  notes: z.string().trim().max(500).nullable(),
  items: z.array(templateItemDraftSchema).min(1).max(MAX_TEMPLATE_ITEMS),
});
export type TemplateDraft = z.infer<typeof templateDraftSchema>;
