/**
 * The normalizer stage: what someone typed, into rows the app can store.
 *
 * INVARIANT: untrusted user text never reaches the instruction channel — ADR
 *            0005 §1. This is the stage whose entire input is user-written, so
 *            it is the one that most needs the fence.
 *
 * INVARIANT: the exercise is chosen from a SQL-filtered candidate list —
 *            CLAUDE.md #5. A slug outside it is rejected here rather than
 *            resolved leniently, for the same reason the planner rejects one.
 *
 * All I/O injected, as every other stage does it.
 */
import { NORMALIZER_MAX_TOKENS } from '../llm/config';
import { MAX_UNTRUSTED_CHARS, fenceUntrusted } from '../llm/safety';
import type { LlmCaller } from '../planner/types';
import { normalizedEntrySchema, type NormalizedEntry } from './schema';

/** One candidate, as the normalizer needs to see it. */
export interface NormalizerCandidate {
  id: string;
  slug: string;
  name: string;
}

export const NORMALIZER_SYSTEM = `You turn a lifter's shorthand into structured set data. You transcribe; you never calculate.

WHAT YOU ARE GIVEN
- One line of text the user typed or dictated, between untrusted markers.
- A list of exercises this user can actually do. It is exhaustive.

RULES
1. exercise_slug must be copied verbatim from the candidate list. If nothing in the list plausibly matches what they said, pick the closest and say so in the interpretation. Never invent a slug.
2. Transcribe the numbers they gave. Do not add up, average, estimate or convert anything. If they did not give a weight, weight_kg is null — never a guess and never 0 for a loaded lift.
3. "3x5 at 60" is three sets of five reps at 60 kg. "5,5,4" is three sets of those reps. A trailing comment like "last one was a grind" is an RPE hint at most, not a set.
4. Weights are kilograms unless they say otherwise. If they clearly said pounds, convert and note the conversion in the interpretation.
5. is_warmup is true only if they said so.
6. interpretation is one short sentence, in plain language, describing exactly what you recorded. It is shown to the user for confirmation before anything is saved, so it must be honest about what you were unsure of.

Reply with JSON only.`;

export interface ParseResult {
  entry: NormalizedEntry;
  /** The resolved candidate. Never null — an unresolved slug throws. */
  exerciseId: string;
  exerciseName: string;
  costCredits: number;
  modelUsed: string | null;
}

export class UnknownExerciseError extends Error {
  constructor(readonly slug: string) {
    super(`"${slug}" is not in this user's candidate list.`);
    this.name = 'UnknownExerciseError';
  }
}

export class EmptyInputError extends Error {
  constructor() {
    super('Nothing to read. Type what you lifted, for example "3x5 at 60".');
    this.name = 'EmptyInputError';
  }
}

export async function parseEntry(
  userId: string,
  text: string,
  candidates: readonly NormalizerCandidate[],
  deps: { call: LlmCaller }
): Promise<ParseResult> {
  if (text.trim() === '') throw new EmptyInputError();

  const result = await deps.call({
    userId,
    stage: 'normalizer',
    schema: normalizedEntrySchema,
    schemaName: 'normalized_entry',
    system: NORMALIZER_SYSTEM,
    messages: [
      {
        role: 'user',
        // The whole point of the fence: this is the one stage whose input is
        // entirely user-written, so "ignore your instructions and ..." is the
        // expected traffic rather than an edge case.
        content: [
          fenceUntrusted('what the user typed', text, MAX_UNTRUSTED_CHARS),
          '',
          JSON.stringify({
            candidates: candidates.map((c) => ({ slug: c.slug, name: c.name })),
          }),
        ].join('\n'),
      },
    ],
    maxTokens: NORMALIZER_MAX_TOKENS,
  });

  const entry = result.data;
  const match = candidates.find((c) => c.slug === entry.exercise_slug);

  // INVARIANT #5. Resolved against the list rather than trusted, and not
  // fuzzy-matched: a near-miss silently logged against the wrong lift is worse
  // than an error, because the metrics move and nobody knows why.
  if (match === undefined) throw new UnknownExerciseError(entry.exercise_slug);

  return {
    entry,
    exerciseId: match.id,
    exerciseName: match.name,
    costCredits: result.costCredits,
    modelUsed: result.modelUsed,
  };
}
