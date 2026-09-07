/**
 * The free-text parse action's state shape and its initial value.
 *
 * Separated from actions.ts for the same reason as app/coach/state.ts: a
 * "use server" module may export async functions and nothing else.
 */
import type { NormalizedSet } from '@/src/normalizer/schema';

export interface ParseState {
  interpretation: string | null;
  exerciseId: string | null;
  exerciseName: string | null;
  sets: NormalizedSet[];
  error: string | null;
}

export const EMPTY_PARSE: ParseState = {
  interpretation: null,
  exerciseId: null,
  exerciseName: null,
  sets: [],
  error: null,
};
