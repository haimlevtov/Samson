/**
 * Free text into validated set data.
 *
 * INVARIANT — and the distinction matters: the model TRANSCRIBES numbers the
 * user said. It does not compute any. "Three by five at sixty" becomes three
 * sets of five at 60 kg; nothing is derived, summed or estimated. e1RM and
 * tonnage are still `src/metrics/`'s job, from the rows this writes.
 *
 * WHY that distinction needs defending: transcription can still be wrong, and a
 * wrong set silently entering the log corrupts every metric downstream. So
 * nothing here writes on its own — `interpretation` exists to be shown back to
 * the user, and the write happens after they agree. A misheard set is worse
 * than no set, because they will not notice it.
 */
import { z } from 'zod';

export const normalizedSetSchema = z.strictObject({
  /** INVARIANT: kilograms — CLAUDE.md #8. Null for genuinely unloaded work. */
  weight_kg: z.number().min(0).max(500).nullable(),
  reps: z.int().min(1).max(100),
  rpe: z.number().min(1).max(10).nullable(),
  is_warmup: z.boolean(),
});
export type NormalizedSet = z.infer<typeof normalizedSetSchema>;

export const normalizedEntrySchema = z.strictObject({
  /**
   * INVARIANT: chosen from the pre-filtered candidate list — CLAUDE.md #5.
   *            `parse.ts` rejects a slug that is not in it, exactly as the
   *            planner's `equipment_available` rule does.
   */
  exercise_slug: z.string().min(1).max(120),
  sets: z.array(normalizedSetSchema).min(1).max(20),
  /**
   * A plain-language echo of what was understood, shown to the user before
   * anything is written. Never stored, never used for arithmetic.
   */
  interpretation: z.string().min(1).max(200),
});
export type NormalizedEntry = z.infer<typeof normalizedEntrySchema>;
