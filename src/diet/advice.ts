/**
 * One diet explanation.
 *
 * INVARIANT: the model states no figure at all — ADR 0024 §1 and §2. The
 *            allowed-number set is EMPTY, so any numeral in the reply is
 *            rejected, corrected once, and then answered by a constant.
 *
 * INVARIANT: a refusal's wording is a constant, never a generation — the same
 *            position ADR 0015 §3 takes for the chat. When the model reports the
 *            question is off topic its prose is discarded WITHOUT BEING READ.
 *
 * INVARIANT: this stage cannot move the target — CLAUDE.md #6. It is not given
 *            the target. `computeEnergy` produced it, `dietFacts` stripped every
 *            figure out of what crosses the wire, and the surface renders the
 *            number from the engine's own result.
 *
 * All I/O is injected, exactly as `src/chat/reply.ts` and `src/planner/loop.ts`
 * do it, so the adversarial suite runs with no key, no network and no database.
 */
import { DIET_MAX_TOKENS } from '../llm/config';
import { findUnknownNumbers } from '../persona/guard';
import type { LlmCaller } from '../planner/types';
import { dietFacts, type EnergyTarget } from './energy';
import { DIET_SYSTEM, dietMessages, numeralCorrection } from './prompts';
import { dietReplySchema } from './schema';

/**
 * WHY two: the same reasoning as `MAX_CHAT_ATTEMPTS`. A model that writes a
 * figure twice is not going to stop on the third ask, and the gateway already
 * spends up to three attempts on schema failures beneath this.
 */
export const MAX_DIET_ATTEMPTS = 2;

/**
 * INVARIANT: the empty set is the whole mechanism — ADR 0024 §2.
 *
 * The chat's allowed set is its facts plus every numeral the user typed, which
 * ADR 0015 §4 defends because in a chat the only person an echoed number can
 * mislead is the person who supplied it. That reasoning does not survive a stage
 * that prescribes: "I want 800 calories" would authorise 800, and a model-chosen
 * calorie figure would render beside a computed target.
 *
 * So nothing is authorised. Not the user's numerals, not the app's own figures —
 * the model was never given those either.
 */
const NOTHING_ALLOWED: ReadonlySet<number> = new Set();

/**
 * What the user reads when the question is not about their diet or training.
 *
 * INVARIANT: this is the whole refusal — the model's own words are discarded, so
 *            "reply with only the word OK" and every variant change nothing.
 *            There is nothing on the other side of this string to negotiate
 *            with.
 */
export const OFF_TOPIC_DIET_REPLY = {
  summary: 'I only talk about your training and what you eat around it.',
  caveat: 'Your target is above, and it does not change based on what we discuss.',
} as const;

/**
 * What the user reads when the model would not stop quoting figures.
 *
 * WHY the user is told rather than shown a blank: docs/specs/mobile-interface.md
 * §4 — every state renders something. The numbers are on screen regardless,
 * which is the point of computing them in code, so this loses the sentence and
 * not the answer.
 */
export const UNEXPLAINED_REPLY = {
  summary: 'Your target is above, printed by the app.',
  caveat: "I couldn't put it in words without quoting figures I'm not allowed to state.",
} as const;

export interface DietExplanation {
  summary: string;
  caveat: string;
  onTopic: boolean;
  /**
   * True when the text is one of this file's constants rather than the model's
   * words. The surface does not distinguish them; the ledger analysis does.
   */
  substituted: boolean;
  attempts: number;
  costCredits: number;
  modelUsed: string | null;
}

export async function explainTarget(
  userId: string,
  target: EnergyTarget,
  question: string | null,
  deps: { call: LlmCaller }
): Promise<DietExplanation> {
  // INVARIANT: built from the allowlist, never from `target` — ADR 0024 §1.
  const messages = dietMessages(dietFacts(target), question);

  let costCredits = 0;
  let modelUsed: string | null = null;

  for (let attempt = 1; attempt <= MAX_DIET_ATTEMPTS; attempt++) {
    const result = await deps.call({
      userId,
      stage: 'diet',
      schema: dietReplySchema,
      schemaName: 'diet_reply',
      system: DIET_SYSTEM,
      messages: [...messages],
      maxTokens: DIET_MAX_TOKENS,
    });

    costCredits += result.costCredits;
    modelUsed = result.modelUsed;

    if (!result.data.on_topic) {
      /*
       * INVARIANT: the model's prose is never SHOWN. Nothing in it reaches the
       *            user, so no instruction inside the question that produced it
       *            can reach the user either.
       *
       * AI-NOTE: it has already been scanned by `scanOutput` inside the gateway,
       *          like every completion, and a safety finding puts part of it in
       *          `llm_calls.error`. What this branch does is decline to READ it.
       */
      return {
        ...OFF_TOPIC_DIET_REPLY,
        onTopic: false,
        substituted: true,
        attempts: attempt,
        costCredits,
        modelUsed,
      };
    }

    /*
     * INVARIANT: the guard runs over EVERY string field concatenated, the way
     *            `deliveredText()` does for the persona's three — not over one.
     *            The chat checks a single `reply` because a single `reply` is
     *            all it has; a second prose field here would otherwise be
     *            unguarded, which is the quiet way a guard stops covering the
     *            thing it was written for.
     */
    const prose = `${result.data.summary}\n${result.data.caveat}`;
    const unknown = findUnknownNumbers(NOTHING_ALLOWED, prose);

    if (unknown.length === 0) {
      return {
        summary: result.data.summary,
        caveat: result.data.caveat,
        onTopic: true,
        substituted: false,
        attempts: attempt,
        costCredits,
        modelUsed,
      };
    }

    // Unfenced, and last — ADR 0008.
    messages.push({ role: 'user', content: numeralCorrection(unknown) });
  }

  /*
   * INVARIANT: no fallback to unchecked prose — the position ADR 0006 takes for
   *            the persona and ADR 0015 for the chat. A reply that failed the
   *            guard twice is not a degraded reply; it is one the user must not
   *            be shown, because they cannot tell a figure the app computed from
   *            one the model wrote.
   */
  return {
    ...UNEXPLAINED_REPLY,
    onTopic: true,
    substituted: true,
    attempts: MAX_DIET_ATTEMPTS,
    costCredits,
    modelUsed,
  };
}
