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
 * Any digit, in any script.
 *
 * FOUND IN REVIEW, and it falsified this stage's headline claim. The guard was
 * `findUnknownNumbers(new Set(), prose)`, whose pattern is `\d` — **ASCII only,
 * even under the `u` flag**. So `١٨٠٠` (Arabic-Indic), `१८००` (Devanagari),
 * `１８００` (fullwidth) and `¹⁸⁰⁰` (superscript) all passed, and the model's
 * figure rendered directly beneath the engine's. Asking the question in Arabic,
 * Persian, Hindi or Bengali is enough to get a reply in native digits; no
 * jailbreak needed. `advice.test.ts` could not see it either, because its
 * assertion was `not.toMatch(/\d/)` — the test and the bug shared a blind spot.
 *
 * WHY not widen `findUnknownNumbers` instead: `\p{Nd}` there would match, and
 * then `Number('١٨٠٠')` is `NaN` and `guard.ts` SKIPS non-finite values — the
 * widened match would be silently discarded and nothing would change. NFKC
 * normalisation is only a partial fix: it folds fullwidth and superscripts and
 * leaves Arabic-Indic and Devanagari alone. The ASCII assumption in `guard.ts`
 * is load-bearing for the chat and the persona, where numerals are compared
 * against a set of numbers; it is left as it is.
 *
 * This stage does not need membership logic at all, because nothing is allowed.
 * `\p{N}` covers Nd, Nl and No, which is every case above in one predicate.
 *
 * AI-NOTE: if this stage ever gains an allowed set, this check cannot simply be
 *          deleted in favour of `findUnknownNumbers` — that would reopen exactly
 *          this hole. The non-ASCII digit problem would have to be solved in
 *          `guard.ts` first, including the `Number.isFinite` skip.
 */
const ANY_DIGIT = /\p{N}/u;

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
     * INVARIANT: the guard runs over EVERY string field, the way
     *            `deliveredText()` does for the persona's three — not over one.
     *            The chat checks a single `reply` because a single `reply` is
     *            all it has; a second prose field here would otherwise be
     *            unguarded, which is the quiet way a guard stops covering the
     *            thing it was written for.
     *
     * FOUND IN REVIEW: this listed the two fields by name, so the comment above
     * was a promise the code did not keep — adding a third to the schema would
     * have left it unchecked with no test failing. Derived from the parsed
     * object instead, so the schema is the only place the field list exists.
     */
    const prose = Object.values(result.data)
      .filter((value): value is string => typeof value === 'string')
      .join('\n');

    if (!ANY_DIGIT.test(prose)) {
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
    messages.push({ role: 'user', content: numeralCorrection() });
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
