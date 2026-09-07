/**
 * What one chat turn returns.
 *
 * Design and threat model: ADR 0015. The contract, including why each bound is
 * the number it is: docs/specs/coach-chat.md §2.
 */
import { z } from 'zod';

import { MAX_CHAT_MESSAGE_CHARS } from '../llm/config';

export const chatReplySchema = z.strictObject({
  /**
   * Whether the user's message is about their own training.
   *
   * INVARIANT: declared FIRST, deliberately — ADR 0015 §3. A model generating
   *            tokens in order commits to the classification before it writes
   *            the answer, rather than justifying an answer it has already
   *            written. Reordering these two fields is a behavioural change,
   *            not a cosmetic one.
   *
   * AI-NOTE: this is the model classifying itself, which is a mitigation and
   *          not a control. What it actually buys is that the WORDING of a
   *          refusal is code — see `OFF_TOPIC_REPLIES`. Do not describe this
   *          field, in a report or a comment, as confining the chat.
   */
  on_topic: z.boolean(),

  /**
   * The answer, at most 700 characters — a few sentences on a phone.
   *
   * WHY it is required even when `on_topic` is false: a nullable field would
   * give the model a second way to return nothing, and the caller discards this
   * string in that branch regardless.
   */
  reply: z.string().min(1).max(700),
});

export type ChatReply = z.infer<typeof chatReplySchema>;

/**
 * One turn of the visible transcript.
 *
 * `coach` rather than `assistant` because this is the app's own shape: it is
 * what the UI renders and what the server action round-trips. The mapping onto
 * the gateway's `ChatMessage` roles happens in `prompt.ts`, which is also where
 * the fencing happens — so a turn cannot reach a model without passing the one
 * function that knows which side it came from.
 */
export interface ChatTurn {
  role: 'user' | 'coach';
  text: string;
}

/**
 * The transcript kept between messages.
 *
 * INVARIANT: validated on arrival — ADR 0015 §1. This stage has no write path,
 *            so the transcript is not stored: it is held by the client and
 *            comes back with every request. That makes it user input, exactly
 *            as the message is, and it is parsed rather than trusted.
 *
 * AI-NOTE: the roles here are a CLAIM about who said what, not a fact. Nothing
 *          downstream may treat a `coach` turn as trusted — `prompt.ts` fences
 *          both kinds and gives neither an assistant role. If you ever add
 *          server-side storage, this schema stays: the client would still be
 *          the one telling us which conversation it is.
 */
export const chatTurnSchema = z.strictObject({
  role: z.enum(['user', 'coach']),
  // Bounded per turn so no single one can flood the payload. `sanitizeUntrusted`
  // truncates below this again; this is the parse-time rejection.
  text: z.string().min(1).max(MAX_CHAT_MESSAGE_CHARS),
});

/**
 * How much scrollback survives a round trip.
 *
 * WHY bounded well above `MAX_HISTORY_TURNS` (8): the model sees the last few
 * turns, but the user reads further back than the coach remembers, and losing
 * the visible conversation mid-chat is worse than a coach with a short memory.
 * It is still bounded, because every turn here is re-sent on every message.
 */
export const MAX_TRANSCRIPT_TURNS = 40;

export const chatHistorySchema = z.array(chatTurnSchema).max(MAX_TRANSCRIPT_TURNS);
