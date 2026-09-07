/**
 * The chat action's state shape.
 *
 * WHY it is not in actions.ts: a "use server" module may export async functions
 * and nothing else. Exporting a plain object from one compiles and type-checks
 * cleanly, then fails at module evaluation with "can only export async
 * functions, found object" — see the same note on ./state.ts, which is where
 * this project learned it.
 *
 * WHY the transcript lives in this state rather than in a table: the chat has
 * no database write path, and that absence is a load-bearing part of ADR 0015
 * §1 — it is why a jailbroken chat cannot persist anything. The cost is that
 * the transcript is client-held, therefore untrusted, therefore parsed by
 * `chatHistorySchema` and fenced turn by turn. That trade is argued in the ADR.
 */
import type { ChatTurn } from '@/src/chat/schema';

export interface ChatState {
  /** The visible conversation, oldest first. Bounded by MAX_TRANSCRIPT_TURNS. */
  turns: ChatTurn[];
  error: string | null;
}

export const EMPTY_CHAT: ChatState = { turns: [], error: null };
