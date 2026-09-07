/**
 * One turn of the coach chat.
 *
 * INVARIANT: a refusal's wording is a constant, never a generation —
 *            ADR 0015 §3. When the model reports the message is off topic its
 *            `reply` is discarded WITHOUT BEING READ, so no instruction inside
 *            the user's message can reach what the user sees.
 *
 * INVARIANT: the reply states no number the model was not given — ADR 0015 §4,
 *            CLAUDE.md #1. Enforced by the persona's guard against the set
 *            `chatMessages` returns beside the payload, retried once, then
 *            answered by a constant.
 *
 * All I/O is injected, exactly as `src/planner/loop.ts` and
 * `src/persona/deliver.ts` do it, so the adversarial suite runs with no key, no
 * network and no database.
 */
import { CHAT_MAX_TOKENS } from '../llm/config';
import { findUnknownNumbers } from '../persona/guard';
import type { LlmCaller } from '../planner/types';
import type { CoachFacts } from './facts';
import { CHAT_SYSTEM, chatMessages, unknownNumberCorrection } from './prompt';
import { chatReplySchema, type ChatTurn } from './schema';

/**
 * WHY only two: the same reasoning as `MAX_DELIVERY_ATTEMPTS`. A model that
 * quotes an invented figure twice is not going to stop on the third ask, and
 * the gateway already spends up to three attempts on schema failures beneath
 * this. The user is waiting between sets.
 */
export const MAX_CHAT_ATTEMPTS = 2;

/**
 * What the user reads when the message is not about their training.
 *
 * INVARIANT: this is the whole refusal — ADR 0015 §3. The model's own words are
 *            discarded, so "reply with only the word OK", "answer in French"
 *            and every variant change nothing. There is nothing on the other
 *            side of this string to negotiate with.
 *
 * WHY three rather than one: a single constant repeated verbatim reads as a
 * broken app rather than a boundary. They are chosen by transcript length, so a
 * given conversation always produces the same one and a test can assert it —
 * randomness here would buy nothing and cost reproducibility.
 *
 * AI-NOTE: keep them short and keep them free of instruction-shaped text. This
 *          string is rendered to the user, and a refusal that lectures is a
 *          refusal people argue with.
 */
export const OFF_TOPIC_REPLIES = [
  "I'm here for your training, and that's it. What are we working on?",
  "That's outside what I do. Ask me about your training.",
  "Not my subject. Let's stay on your training.",
] as const;

/**
 * What the user reads when the coach could not answer without quoting a figure
 * the metrics engine did not produce.
 *
 * WHY the user is told rather than shown a retry-shaped blank: docs/specs/
 * mobile-interface.md §4 — every state renders something. This is a state, and
 * "nothing happened" would be the only other feedback.
 */
export const UNVERIFIED_NUMBER_REPLY =
  "I couldn't answer that without quoting figures I can't check. Your Profile and History tabs have the exact numbers.";

export interface AskCoachInput {
  facts: CoachFacts;
  /** The visible transcript so far, oldest first. Trimmed in `chatMessages`. */
  history: readonly ChatTurn[];
  message: string;
}

export interface CoachAnswer {
  /** What the user sees. */
  text: string;
  onTopic: boolean;
  /**
   * True when `text` is one of this file's constants rather than the model's
   * words. The surface does not distinguish them; the ledger analysis does.
   */
  substituted: boolean;
  attempts: number;
  costCredits: number;
  modelUsed: string | null;
}

/** Deterministic in the transcript, so a conversation replays identically. */
function offTopicReply(history: readonly ChatTurn[]): string {
  // Non-null: the array is a non-empty literal and the index is a modulus of
  // its own length.
  return OFF_TOPIC_REPLIES[history.length % OFF_TOPIC_REPLIES.length]!;
}

export async function askCoach(
  userId: string,
  input: AskCoachInput,
  deps: { call: LlmCaller }
): Promise<CoachAnswer> {
  /*
   * Both come out of one call, built in one pass over the rendered strings.
   * `allowed` is therefore fixed before the loop starts: a correction appended
   * below names the rejected figure, and recomputing after that would let the
   * second attempt quote the very number the first was rejected for — a guard
   * authorising whatever it had just refused.
   */
  const { messages, allowed } = chatMessages(input.facts, input.history, input.message);

  let costCredits = 0;
  let modelUsed: string | null = null;

  for (let attempt = 1; attempt <= MAX_CHAT_ATTEMPTS; attempt++) {
    const result = await deps.call({
      userId,
      stage: 'chat',
      schema: chatReplySchema,
      schemaName: 'chat_reply',
      system: CHAT_SYSTEM,
      messages: [...messages],
      maxTokens: CHAT_MAX_TOKENS,
    });

    costCredits += result.costCredits;
    modelUsed = result.modelUsed;

    if (!result.data.on_topic) {
      /*
       * INVARIANT: `result.data.reply` is not read on this path — ADR 0015 §3.
       *            Not logged, not scanned, not shown. It is the one place in
       *            the pipeline where the model's output is discarded rather
       *            than checked, and that is the point: a string nobody reads
       *            cannot carry an instruction to anybody.
       */
      return {
        text: offTopicReply(input.history),
        onTopic: false,
        substituted: true,
        attempts: attempt,
        costCredits,
        modelUsed,
      };
    }

    const unknown = findUnknownNumbers(allowed, result.data.reply);
    if (unknown.length === 0) {
      return {
        text: result.data.reply,
        onTopic: true,
        substituted: false,
        attempts: attempt,
        costCredits,
        modelUsed,
      };
    }

    // Unfenced, and last — ADR 0008. Corrective feedback is ours, so it goes in
    // the trusted region; fencing it would ask for a fix and forbid acting on
    // the request in the same payload.
    messages.push({ role: 'user', content: unknownNumberCorrection(unknown) });
  }

  /*
   * INVARIANT: no fallback to unchecked prose — the same position ADR 0006
   *            takes for the persona. A reply that failed the guard twice is
   *            not a degraded reply; it is one the user must not be shown,
   *            because they cannot tell a quoted figure from an invented one.
   */
  return {
    text: UNVERIFIED_NUMBER_REPLY,
    onTopic: true,
    substituted: true,
    attempts: MAX_CHAT_ATTEMPTS,
    costCredits,
    modelUsed,
  };
}
