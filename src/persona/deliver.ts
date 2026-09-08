/**
 * The persona stage: a finished plan, spoken in a voice.
 *
 * INVARIANT: the persona changes delivery, never content — PRD §3, ADR 0006.
 *            It returns prose and never the block, so the numbers the user sees
 *            are the ones the critic approved.
 *
 * All I/O is injected, exactly as `src/planner/loop.ts` does it, so this runs in
 * the unit suite with no key, no network and no database.
 */
import { PERSONA_MAX_TOKENS } from '../llm/config';
import type { LlmCaller } from '../planner/types';
import type { TrainingBlock } from '../planner/schema';
import { stripInvisible } from '../llm/safety';
import { InventedNumberError, assertNoInventedNumbers, deliveredText } from './guard';
import {
  BANNED_PHRASE_CORRECTION,
  PERSONA_SYSTEM,
  inventedNumberCorrection,
  personaUserMessage,
  weekCountCorrection,
} from './prompts';
import { deliveredPlanSchema, type DeliveredPlan, type HumorLevel, type Persona } from './schema';
import { resolveTone, type ToneDecision, type ToneInput } from './tone';

/**
 * WHY only two: the guard rejects on content, not on shape, and a model that
 * invents a number twice in a row is not going to stop on the third ask. The
 * gateway already spends up to three attempts on schema failures underneath
 * this.
 */
export const MAX_DELIVERY_ATTEMPTS = 2;

export interface DeliverInput {
  block: TrainingBlock;
  persona: Persona;
  userHumorMax: HumorLevel;
  tone: ToneInput;
}

export interface DeliverResult {
  delivered: DeliveredPlan;
  tone: ToneDecision;
  attempts: number;
  costCredits: number;
  modelUsed: string | null;
}

export class BannedPhraseError extends Error {
  constructor(readonly phrases: string[]) {
    super(`The persona used phrases its own row forbids: ${phrases.join(', ')}`);
    this.name = 'BannedPhraseError';
  }
}

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

/**
 * Lowercased, stripped of invisible characters, and with every run of
 * punctuation or whitespace collapsed to one space.
 *
 * Applied to BOTH sides of the comparison, which is what makes three separate
 * bypasses go away at once rather than becoming three special cases in a regex:
 *
 * - **Invisible characters.** `src/llm/safety.ts` strips these before its own
 *   scanner looks at anything, for the reason its comment gives — a zero-width
 *   space reads normally to a model and defeats any check matching on literal
 *   words. This guard did not, so `qui<U+200B>tter` walked straight through it.
 * - **Punctuation.** Every persona bans `no pain no gain`, and a model writes
 *   it "no pain, no gain". The most-repeated ban in the table did not fire on
 *   its own canonical form.
 * - **Case.** The lowercasing lived in the caller, one frame up, so the newly
 *   exported matcher returned false on mixed-case prose — a ban that fails
 *   open for whoever calls it next.
 *
 * It also makes possessives work for free: "quitter's" normalises to
 * "quitter s", so a ban on `quitter` fires on it.
 */
function normalisePhrase(value: string): string {
  return stripInvisible(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Whether a delivery used a phrase its persona forbids. Whole words, plus the
 * plural — never a substring.
 *
 * FOUND IN REVIEW, 2026-09-08, by a test written for a different persona: this
 * used `String.includes`, so A SHORT WORD BANNED EVERY WORD CONTAINING IT. The
 * Rival has banned `weak` since phase 3, which therefore also banned
 * **weakness** — and "your weakness is the lockout" is ordinary coaching
 * language.
 *
 * WHY that was not cosmetic: `deliverPlan` has no fallback, by design — ADR
 * 0006 says a delivery that fails the guard is one the user must not be shown.
 * So a plan whose prose happened to contain "weakness" was rejected, retried,
 * rejected again, and the user was handed an error instead of the block the
 * critic had already approved.
 *
 * `src/llm/safety.ts` had reached the same conclusion for the general scanner
 * and written it down — "`fat` and `weak` are ordinary coaching vocabulary" is
 * exactly why that guard matches second-person constructions rather than bare
 * words. This is the persona-level half of the same lesson.
 *
 * THE PLURAL IS INCLUDED because the first fix did not include it, and a second
 * review measured what escaped: `quitters` and `princesses` both passed a list
 * banning the singulars. Plural is the natural register for the barracks idiom
 * the Sergeant's list exists to catch, and `scanOutput` does not cover it —
 * that matches "you're <adjective>", and "no princesses in my gym" is neither.
 *
 * AI-NOTE: a phrase covers itself and its plural, and nothing else. `weak`
 *          matches "weak" and "weaks"; it does not match "weakness",
 *          "weakling" or "weakly". If a list wants another inflection it lists
 *          it — that is the trade for `fat` not banning "fatigue", and it is
 *          the right way round: an over-broad ban fails closed on a user who
 *          did nothing wrong.
 */
export function phraseUsed(haystack: string, phrase: string): boolean {
  const needle = normalisePhrase(phrase);
  if (needle === '') return false;

  const escaped = needle.replace(REGEX_META, '\\$&');
  // Only letters, digits and single spaces survive normalisation, so the
  // lookarounds do their boundary work against spaces rather than punctuation.
  const pattern = `(?<![\\p{L}\\p{N}])${escaped}(?:s|es)?(?![\\p{L}\\p{N}])`;

  return new RegExp(pattern, 'u').test(normalisePhrase(haystack));
}

/**
 * WHY this is checked in code when the prompt already lists them: `never_say` is
 * a column someone fills in to stop a specific phrase reaching users. A list
 * that only holds when the model cooperates is a preference, not a ban.
 */
function bannedPhrasesUsed(persona: Persona, text: string): string[] {
  return persona.bannedPhrases.filter((phrase) => phraseUsed(text, phrase));
}

export async function deliverPlan(
  userId: string,
  input: DeliverInput,
  deps: { call: LlmCaller }
): Promise<DeliverResult> {
  const tone = resolveTone(input.persona, input.userHumorMax, input.tone);
  const baseMessage = personaUserMessage(input.persona, tone, input.block);

  const messages = [{ role: 'user' as const, content: baseMessage }];
  let costCredits = 0;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
    const result = await deps.call({
      userId,
      stage: 'persona',
      schema: deliveredPlanSchema,
      schemaName: 'delivered_plan',
      system: PERSONA_SYSTEM,
      messages: [...messages],
      maxTokens: PERSONA_MAX_TOKENS,
    });

    costCredits += result.costCredits;
    const delivered = result.data;

    // One note per week, positionally. A mismatch means the notes no longer
    // line up with the weeks they describe, which silently misattributes advice.
    if (delivered.week_notes.length !== input.block.weeks.length) {
      lastError = new Error(
        `expected ${input.block.weeks.length} week notes, got ${delivered.week_notes.length}`
      );
      messages.push({
        role: 'user' as const,
        content: weekCountCorrection(input.block.weeks.length, delivered.week_notes.length),
      });
      continue;
    }

    const banned = bannedPhrasesUsed(input.persona, deliveredText(delivered));
    if (banned.length > 0) {
      lastError = new BannedPhraseError(banned);
      messages.push({
        role: 'user' as const,
        content: BANNED_PHRASE_CORRECTION,
      });
      continue;
    }

    try {
      assertNoInventedNumbers(input.block, delivered);
    } catch (cause) {
      if (!(cause instanceof InventedNumberError)) throw cause;
      lastError = cause;
      messages.push({
        role: 'user' as const,
        content: inventedNumberCorrection(cause.numbers),
      });
      continue;
    }

    return { delivered, tone, attempts: attempt, costCredits, modelUsed: result.modelUsed };
  }

  // INVARIANT: no fallback to unchecked prose — ADR 0006. A delivery that fails
  //            the guard is not a degraded delivery; it is one the user must not
  //            be shown, because they cannot tell a quoted number from an
  //            invented one.
  throw lastError ?? new Error('persona delivery failed');
}
