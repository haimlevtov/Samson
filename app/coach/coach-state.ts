/**
 * The one box's state shape — rework PR 8a, ADR 0015 §6.
 *
 * Replaces `chat-state.ts`, `diet-state.ts` and `supplement-state.ts`, which
 * were three states because there were three forms. One form, one state: the
 * goal and the figures on one side, the conversation on the other, and the row
 * a supplement answer resolved to.
 *
 * WHY it is not in actions.ts: a `'use server'` module may export async
 * functions and nothing else. Exporting a plain object from one compiles and
 * type-checks cleanly, then fails at module evaluation with "can only export
 * async functions, found object" — the note the three files it replaces each
 * carried, and ./state.ts is where this project learned it.
 *
 * WHY nothing here is persisted, in two parts, because the reasons differ:
 *
 * - **The transcript** is client-held because the stage has no database write
 *   path, and that absence is a load-bearing part of ADR 0015 §1 — it is why a
 *   jailbroken box cannot persist anything. The cost is that it arrives as
 *   untrusted input and is parsed by `chatHistorySchema` and fenced turn by
 *   turn. That trade is argued in the ADR.
 * - **The figures** are a pure function of the Settings values and today's
 *   date, so storing them would create a second source of truth that goes stale
 *   the moment a weight changes — `docs/plans/phase-6.md`, "what is
 *   deliberately out".
 */
import type { ChatTurn } from '@/src/chat/schema';
import type { EvidenceRow } from '@/src/db/evidence';
import type { EnergyResult } from '@/src/diet/energy';

export interface CoachState {
  /** The visible conversation, oldest first. Bounded by MAX_TRANSCRIPT_TURNS. */
  turns: ChatTurn[];
  /**
   * The engine's answer for the selected goal — a target, or one of ADR 0024's
   * three refusals. Computed on every submission including a bare goal change,
   * because it costs no model call.
   */
  result: EnergyResult | null;
  /** Echoed back so the select keeps its value across a round trip. */
  goal: string;
  /**
   * The row a `supplement` answer resolved to, for the newest turn only.
   *
   * INVARIANT: this is an object from the array the schema's allowlist was
   *            built from — ADR 0023. There is no model-authored string in it,
   *            which is the point of the retrieval-only shape rather than an
   *            accident of the type.
   */
  row: EvidenceRow | null;
  error: string | null;
}

export const EMPTY_COACH: CoachState = {
  turns: [],
  result: null,
  goal: 'maintain',
  row: null,
  error: null,
};
