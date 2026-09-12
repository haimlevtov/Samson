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
 * - **The transcript** is client-held because there is no write path for it,
 *   which is a load-bearing part of ADR 0015 §1. The cost is that it arrives as
 *   untrusted input and is parsed by `chatHistorySchema` and fenced turn by
 *   turn. That trade is argued in the ADR.
 *
 *   _This used to say the absence was "why a jailbroken box cannot persist
 *   anything". ADR 0030 retired that sentence: the box can now persist one
 *   validated, user-removable note. The TRANSCRIPT still has no write path, and
 *   every consequence above still follows from that._
 * - **The figures** are a pure function of the Settings values and today's
 *   date, so storing them would create a second source of truth that goes stale
 *   the moment a weight changes — `docs/plans/phase-6.md`, "what is
 *   deliberately out".
 */
import type { ChatTurn } from '@/src/chat/schema';
import type { EvidenceRow } from '@/src/db/evidence';
import type { DietGoal, EnergyResult } from '@/src/diet/energy';

export interface CoachState {
  /** The visible conversation, oldest first. Bounded by MAX_TRANSCRIPT_TURNS. */
  turns: ChatTurn[];
  /**
   * The engine's answer for the selected goal — a target, or one of ADR 0024's
   * three refusals. Computed on every submission including a bare goal change,
   * because it costs no model call.
   */
  result: EnergyResult | null;
  /**
   * Echoed back so the select keeps its value across a round trip.
   *
   * `DietGoal`, derived from `DIET_GOALS`, rather than `string` — CLAUDE.md
   * § Conventions. The action narrows it with `z.enum` before it gets here, so
   * typing it wider would only hide that the narrowing happened.
   */
  goal: DietGoal;
  /**
   * The row a `supplement` answer resolved to, for the newest turn only.
   *
   * INVARIANT: this is an object from the array the schema's allowlist was
   *            built from — ADR 0023. There is no model-authored string in it,
   *            which is the point of the retrieval-only shape rather than an
   *            accident of the type.
   */
  row: EvidenceRow | null;
  /**
   * The newest answer was a supplement question no row covered.
   *
   * WHY a flag rather than the surface comparing the turn's text against
   * `NO_SUPPLEMENT_MATCH_REPLY`: that comparison was the first shape, and it was
   * wrong twice over. A user who typed that sentence verbatim would have got the
   * `/evidence` link rendered under their OWN turn, and importing the constant
   * dragged `src/chat/reply.ts`'s whole graph — the system prompt, the guards,
   * `src/llm/safety.ts` — into the client bundle. The server knows the answer's
   * route; it says so here.
   */
  supplementMiss: boolean;
  error: string | null;
}

export const EMPTY_COACH: CoachState = {
  turns: [],
  result: null,
  goal: 'maintain',
  row: null,
  supplementMiss: false,
  error: null,
};
