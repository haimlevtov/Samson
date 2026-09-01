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
import { InventedNumberError, assertNoInventedNumbers, deliveredText } from './guard';
import {
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

/**
 * WHY this is checked in code when the prompt already lists them: `never_say` is
 * a column someone fills in to stop a specific phrase reaching users. A list
 * that only holds when the model cooperates is a preference, not a ban.
 */
function bannedPhrasesUsed(persona: Persona, text: string): string[] {
  const haystack = text.toLowerCase();
  return persona.bannedPhrases.filter((phrase) => haystack.includes(phrase.toLowerCase()));
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
        content: `Do not use: ${banned.join(', ')}. Rewrite without them.`,
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
