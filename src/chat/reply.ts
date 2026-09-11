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
import type { EvidenceRow } from '../db/evidence';
import type { DietFacts } from '../diet/energy';

import type { CoachFacts } from './facts';
import { CHAT_SYSTEM, chatMessages, numeralCorrection, unknownNumberCorrection } from './prompts';
import { NO_MATCH, coachReplySchema, type CoachRoute, type ChatTurn } from './schema';

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

/**
 * What the user reads when the diet route would not stop quoting figures.
 *
 * Moved here from `src/diet/advice.ts` with the stage it belonged to — ADR 0015
 * §6. It is one string rather than that stage's `summary` and `caveat` because
 * one box returns one answer; the guarantee was never the field count.
 */
export const UNEXPLAINED_DIET_REPLY =
  "Your target is above, printed by the app. I couldn't put it in words without quoting figures I'm not allowed to state.";

/**
 * What the user reads when no row in the evidence table covers the question.
 *
 * INVARIANT: a constant, not a generation — ADR 0023. The model has no say in
 *            it, and on this route its own prose is not read at all.
 *
 * The pointer to the whole table is rendered as a LINK beside this by the
 * panel rather than written into the string, so it is a real anchor.
 */
export const NO_SUPPLEMENT_MATCH_REPLY =
  'The evidence table does not cover that one. It holds a small, curated set —';

/**
 * The transcript line beside a supplement row.
 *
 * INVARIANT: a constant, because the alternative is the model's own prose about
 *            the row — which ADR 0023 refuses. The row's claim, grade, dose and
 *            citation render underneath it, in the table's own words, and this
 *            line exists only so the conversation does not have a turn with no
 *            text in it.
 */
export const SUPPLEMENT_ANSWER_TURN = 'Here is what the evidence table says.';

/**
 * Any digit, in any script.
 *
 * Moved from `src/diet/advice.ts` with the guard it implements, comment and all,
 * because deleting the reasoning would invite the bug back.
 *
 * FOUND IN REVIEW of the diet stage, and it falsified that stage's headline
 * claim. The guard was `findUnknownNumbers(new Set(), prose)`, whose pattern is
 * `\d` — **ASCII only, even under the `u` flag**. So `١٨٠٠` (Arabic-Indic),
 * `१८००` (Devanagari), `１８００` (fullwidth) and `¹⁸⁰⁰` (superscript) all
 * passed, and the model's figure rendered directly beneath the engine's. Asking
 * the question in Arabic, Persian, Hindi or Bengali was enough; no jailbreak
 * needed. The test could not see it either, because its assertion was
 * `not.toMatch(/\d/)` — the test and the bug shared a blind spot.
 *
 * WHY not widen `findUnknownNumbers` instead: `\p{Nd}` there would match, and
 * then `Number('١٨٠٠')` is `NaN` and `guard.ts` SKIPS non-finite values — the
 * widened match would be silently discarded and nothing would change. NFKC
 * normalisation is only a partial fix: it folds fullwidth and superscripts and
 * leaves Arabic-Indic and Devanagari alone. The ASCII assumption in `guard.ts`
 * is load-bearing for the training route and the persona, where numerals are
 * compared against a set of numbers; it is left as it is.
 *
 * The diet route needs no membership logic at all, because nothing is allowed.
 * `\p{N}` covers Nd, Nl and No, which is every case above in one predicate.
 *
 * AI-NOTE: if the diet route ever gains an allowed set, this check cannot simply
 *          be deleted in favour of `findUnknownNumbers` — that would reopen
 *          exactly this hole. The non-ASCII digit problem would have to be
 *          solved in `guard.ts` first, including the `Number.isFinite` skip.
 */
const ANY_DIGIT = /\p{N}/u;

export interface AskCoachInput {
  facts: CoachFacts;
  /** The visible transcript so far, oldest first. Trimmed in `chatMessages`. */
  history: readonly ChatTurn[];
  message: string;
  /**
   * The diet categories, or null when the engine could not produce a target —
   * ADR 0024's three refusals. A diet question then routes as it likes and is
   * answered from categories that do not exist, so the caller renders the
   * engine's own refusal instead.
   */
  diet: DietFacts | null;
  /** The rows the supplement route may name. RLS-scoped, shared rows only. */
  evidence: readonly EvidenceRow[];
}

export interface CoachAnswer {
  /** Which guard ran — ADR 0015 §6. */
  route: CoachRoute;
  /**
   * What the user reads. **Null on the `supplement` route**, where the row is
   * the answer and the model's prose is never shown.
   */
  text: string | null;
  /** The row to render, on the `supplement` route and only there. */
  row: EvidenceRow | null;
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
  const { messages, allowed } = chatMessages(input.facts, input.history, input.message, {
    diet: input.diet,
    evidence: input.evidence,
  });

  // INVARIANT: the allowlist IS the schema — ADR 0023, kept through the merge.
  //            Built from the same array the row is resolved against below.
  const schema = coachReplySchema(input.evidence.map((row) => row.slug));

  let costCredits = 0;
  let modelUsed: string | null = null;
  /*
   * The route of the LAST attempt, which decides which constant the exhausted
   * loop falls to. It is deliberately not the first attempt's: a model that
   * changed its mind about what the question was is answering the second
   * question, and the message it gets should be about the guard that actually
   * rejected it.
   */
  let lastRoute: CoachRoute = 'training';

  for (let attempt = 1; attempt <= MAX_CHAT_ATTEMPTS; attempt++) {
    const result = await deps.call({
      userId,
      stage: 'chat',
      schema,
      schemaName: 'coach_reply',
      system: CHAT_SYSTEM,
      messages: [...messages],
      maxTokens: CHAT_MAX_TOKENS,
    });

    costCredits += result.costCredits;
    modelUsed = result.modelUsed;

    const { route, reply, supplement_slug: slug } = result.data;
    lastRoute = route;
    const spent = { route, attempts: attempt, costCredits, modelUsed };

    if (route === 'off_topic') {
      /*
       * INVARIANT: `reply` is never SHOWN — ADR 0015 §3. Nothing in it reaches
       *            the user, so no instruction inside the message that produced
       *            it can reach the user either.
       *
       * AI-NOTE: it has already been scanned by `scanOutput` inside the
       *          gateway, like every completion, and a safety finding puts up
       *          to 80 characters of it in `llm_calls.error`. An earlier
       *          version of this comment claimed "not logged, not scanned",
       *          which was false on both counts. What this branch does is
       *          decline to READ it — its numbers are not checked, because
       *          nothing it says is used.
       */
      return { ...spent, text: offTopicReply(input.history), row: null, substituted: true };
    }

    if (route === 'supplement') {
      /*
       * INVARIANT: the answer is the ROW, never prose about it — ADR 0023. The
       *            model's `reply` is not read on this route, so there is no
       *            generated sentence to guard or to render by accident, and
       *            nothing here needs a number guard.
       *
       * The sentinel is handled BEFORE the lookup, and in the stage this
       * replaced it used to be handled by the lookup failing. Two things were
       * wrong with that: a future editor could replace the `?? null` with an
       * assertion and turn the normal path into a throw, and a migration adding
       * a row whose slug is literally the sentinel would shadow it — every "the
       * table does not cover that" answer would silently render that row.
       */
      if (slug === NO_MATCH) {
        return { ...spent, text: NO_SUPPLEMENT_MATCH_REPLY, row: null, substituted: true };
      }

      /*
       * Resolved against the array that produced the enum, never re-queried by
       * a model-supplied string. The schema has already refused anything
       * outside it, so a miss here means the schema and this array disagree —
       * which fails closed into the constant rather than throwing.
       */
      const row = input.evidence.find((candidate) => candidate.slug === slug) ?? null;
      return {
        ...spent,
        text: row === null ? NO_SUPPLEMENT_MATCH_REPLY : null,
        row,
        substituted: row === null,
      };
    }

    if (route === 'diet') {
      /*
       * INVARIANT: the allowed set is EMPTY — ADR 0024 §1 and §2. The model is
       *            not given the target and may state no figure at all, so the
       *            check is any digit in any script rather than a membership
       *            test. `ANY_DIGIT` carries the review that found why.
       */
      if (!ANY_DIGIT.test(reply)) {
        return { ...spent, text: reply, row: null, substituted: false };
      }

      // Unfenced, and last — ADR 0008. Corrective feedback is ours, so it goes
      // in the trusted region; fencing it would ask for a fix and forbid acting
      // on the request in the same payload.
      messages.push({ role: 'user', content: numeralCorrection() });
      continue;
    }

    /*
     * `training`. The guard is the facts' numeric leaves plus what the user
     * typed — ADR 0015 §4.
     *
     * INVARIANT: this is reached only when the route SAYS training. A retry that
     *            comes back on a different route is checked by that route's
     *            branch above, not by this one. Carrying a guard forward across
     *            a changed route would let a model escape the diet route's empty
     *            allowed set by changing its mind about the question.
     */
    const unknown = findUnknownNumbers(allowed, reply);
    if (unknown.length === 0) {
      return { ...spent, text: reply, row: null, substituted: false };
    }

    messages.push({ role: 'user', content: unknownNumberCorrection(unknown) });
  }

  /*
   * INVARIANT: no fallback to unchecked prose — the same position ADR 0006
   *            takes for the persona. A reply that failed the guard twice is
   *            not a degraded reply; it is one the user must not be shown,
   *            because they cannot tell a quoted figure from an invented one.
   *
   * The constant matches the guard that rejected the last attempt: a diet
   * answer's figures are the app's to print, and a training answer's are not
   * checkable at all. `supplement` and `off_topic` never reach here — both
   * return inside the loop.
   */
  return {
    route: lastRoute,
    text: lastRoute === 'diet' ? UNEXPLAINED_DIET_REPLY : UNVERIFIED_NUMBER_REPLY,
    row: null,
    substituted: true,
    attempts: MAX_CHAT_ATTEMPTS,
    costCredits,
    modelUsed,
  };
}
