/**
 * The diet action's state shape.
 *
 * WHY it is not in actions.ts: a `'use server'` module may export async
 * functions and nothing else. Exporting a plain object from one compiles and
 * type-checks cleanly, then fails at module evaluation with "can only export
 * async functions, found object" — the same note ./chat-state.ts and ./state.ts
 * carry, which is where this project learned it.
 *
 * WHY the computed figures live in this state rather than in a table: they are a
 * pure function of the Settings values and today's date, so storing them would
 * create a second source of truth that goes stale the moment a weight changes —
 * `docs/plans/phase-6.md`, "what is deliberately out". Nothing about the diet
 * advisor is persisted.
 */
import type { EnergyResult } from '@/src/diet/energy';

export interface DietState {
  /** Null until the user asks. The advisor does not fire on page load. */
  result: EnergyResult | null;
  /**
   * The model's two sentences, or one of `src/diet/advice.ts`'s constants.
   *
   * Null when the engine refused: there is no target to explain, and the
   * refusal's own words are rendered by the panel instead.
   */
  summary: string | null;
  caveat: string | null;
  /** Echoed back so the select keeps its value across a round trip. */
  goal: string;
  error: string | null;
}

export const EMPTY_DIET: DietState = {
  result: null,
  summary: null,
  caveat: null,
  goal: 'maintain',
  error: null,
};
