/**
 * Which refusal a failed voice call becomes — the reasons the Voice card
 * explains (docs/specs/mobile-interface.md §4, "Voice refused or fails").
 *
 * WHY a function of its own: `hearCoach` is a server action, and the repo has
 * no harness for those. The mapping is the part worth pinning, because each
 * refusal is a sentence the user reads — a budget refusal shown as "try again"
 * would send them back to press a button that cannot work until the week turns.
 */
import { MissingApiKeyError } from '../llm/config';
import { BudgetExceededError } from '../llm/types';
import type { VoiceRefusal } from './player';

export function refusalFor(cause: unknown): VoiceRefusal {
  if (cause instanceof MissingApiKeyError) return 'no-key';
  if (cause instanceof BudgetExceededError) return 'budget';
  return 'failed';
}
