/**
 * Model fallback arrays, one per pipeline stage.
 *
 * WHY: these are config, not literals scattered through call sites, because
 *      phase 2 measures cost per model tried and needs to swap them without
 *      touching pipeline code.
 *
 * AI-NOTE: every slug here was checked against the OpenRouter /models endpoint
 *          on 2026-08-24 and filtered to those advertising `structured_outputs`
 *          in supported_parameters. If you add one, check it the same way —
 *          a model without structured output support fails every call in the
 *          stage, and `provider.require_parameters` turns that into a routing
 *          error rather than a silent plain-text response.
 */
import type { LlmStage } from './types';

/** Order is preference, not escalation: OpenRouter falls through only on error. */
export const STAGE_MODELS: Record<LlmStage, readonly string[]> = {
  normalizer: ['google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash'],
  /*
   * MEASURED, 2026-09-01: google/gemini-2.5-flash CANNOT serve this stage and
   * is kept only as a transport fallback that will fail fast. It rejects the
   * training-block schema with HTTP 400, "the specified schema produces a
   * constraint that has too many states for serving". Stripping every numeric
   * bound and shrinking the array limits did not help — the four-level nesting
   * itself defeats its constrained decoder.
   *
   * AI-NOTE: do not reach for a cheaper planner model without re-testing the
   *          schema against it first. "Use Flash, it is 10x cheaper" is the
   *          obvious cost lever and it is closed until the schema flattens.
   */
  planner: ['anthropic/claude-sonnet-5', 'google/gemini-2.5-flash'],
  // INVARIANT: the critic runs on a different model from the planner — PLAN.md phase 2
  // WHY: a critic sharing the planner's weights shares its blind spots and
  //      rubber-stamps the same unsafe block. tests assert this holds.
  critic: ['google/gemini-2.5-flash', 'anthropic/claude-haiku-4.5'],
  persona: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash'],
  diet: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash'],
  challenge: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'],
  /*
   * The same pair as the persona, for the same reason: this is prose in a
   * voice, not structured reasoning over a schema. It is also the highest
   * FREQUENCY call in the app — one per message rather than one per plan — so
   * the cheap tier is the right default and a stronger model here would be paid
   * for on every turn of every conversation.
   */
  chat: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash'],
  smoke: ['google/gemini-2.5-flash-lite'],
} as const;

/**
 * What the planner loop retries with after repeated rejection — ADR 0004,
 * "escalate rather than repeat".
 *
 * WHY this is the planner array with the fallback removed rather than a higher
 * tier: every slug in this file was verified against OpenRouter /models for
 * structured-output support, and inventing an unverified one here would fail
 * every escalated call at routing time — the worst possible moment, since
 * escalation only happens on a run that is already struggling.
 *
 * So today this guarantees the last attempt is not served by a *weaker* model
 * than the first, which is the half of the intent that can be honoured without
 * a new slug.
 *
 * AI-NOTE: when a genuinely stronger model is verified the same way the note
 *          above describes, put it here and say so in ADR 0004. Until then do
 *          not pretend this is an upgrade — the phase report must not claim a
 *          cascade saving it did not measure.
 */
export const ESCALATION_MODELS: readonly string[] = ['anthropic/claude-sonnet-5'];

export function modelsForStage(stage: LlmStage, override?: readonly string[]): readonly string[] {
  if (override && override.length > 0) return override;
  return STAGE_MODELS[stage];
}
