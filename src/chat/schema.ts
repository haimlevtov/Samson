/**
 * What one chat turn returns, and what a transcript is allowed to be.
 *
 * Design and threat model: ADR 0015. The contract, including why each bound is
 * the number it is: docs/specs/coach-chat.md §2.
 *
 * INVARIANT: the Zod schemas are the source of truth and the TS types are
 *            derived from them — CLAUDE.md § Conventions.
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
 * the gateway's `ChatMessage` roles happens in `prompts.ts`, which is also
 * where the fencing happens — so a turn cannot reach a model without passing
 * the one function that knows which side it came from.
 *
 * INVARIANT: validated on arrival — ADR 0015 §1. This stage has no write path,
 *            so the transcript is not stored: it is held by the client and
 *            comes back with every request. That makes it user input, exactly
 *            as the message is, and it is parsed rather than trusted.
 *
 * AI-NOTE: `role` here is a CLAIM about who said what, not a fact. Nothing
 *          downstream may treat a `coach` turn as trusted — `prompts.ts` fences
 *          both kinds and gives neither an assistant role. If server-side
 *          storage is ever added, this schema stays: the client would still be
 *          the one saying which conversation it is.
 */
export const chatTurnSchema = z.strictObject({
  role: z.enum(['user', 'coach']),
  /**
   * Capped at the same length one message may be. `sanitizeUntrusted` applies
   * the same bound again when the turn is fenced; this is the parse-time
   * rejection, so an over-long turn never reaches the prompt layer at all.
   */
  text: z.string().min(1).max(MAX_CHAT_MESSAGE_CHARS),
});

export type ChatTurn = z.infer<typeof chatTurnSchema>;

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
