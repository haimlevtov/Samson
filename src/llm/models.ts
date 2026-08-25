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
  planner: ['anthropic/claude-sonnet-5', 'google/gemini-2.5-flash'],
  // INVARIANT: the critic runs on a different model from the planner — PLAN.md phase 2
  // WHY: a critic sharing the planner's weights shares its blind spots and
  //      rubber-stamps the same unsafe block. tests assert this holds.
  critic: ['google/gemini-2.5-flash', 'anthropic/claude-haiku-4.5'],
  persona: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash'],
  diet: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash'],
  challenge: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite'],
  smoke: ['google/gemini-2.5-flash-lite'],
} as const;

export function modelsForStage(stage: LlmStage, override?: readonly string[]): readonly string[] {
  if (override && override.length > 0) return override;
  return STAGE_MODELS[stage];
}
