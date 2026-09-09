/**
 * The supplement lookup's state shape.
 *
 * WHY it is not in actions.ts: a `'use server'` module may export async
 * functions and nothing else — the same note ./chat-state.ts, ./diet-state.ts
 * and ./state.ts carry.
 *
 * The whole answer is a row from `supplement_evidence` or a constant. There is
 * no model-authored string in this state, which is the point of ADR 0023's
 * retrieval-only shape rather than an accident of the type.
 */
import type { EvidenceRow } from '@/src/db/evidence';

export interface SupplementState {
  /** The row to render, or null. */
  row: EvidenceRow | null;
  /** The constant shown when no row matched, or an error. Never a generation. */
  message: string | null;
  error: string | null;
  /** False until the user asks, so "no match" and "not asked yet" differ. */
  asked: boolean;
}

export const EMPTY_SUPPLEMENT: SupplementState = {
  row: null,
  message: null,
  error: null,
  asked: false,
};
