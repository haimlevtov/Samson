/**
 * What one diet explanation returns, and what may be asked of it.
 *
 * INVARIANT: **no numeric field** — ADR 0024 §1. "The model cannot alter a
 *            number" is structural here before it is tested, which is the shape
 *            `docs/plans/phase-3.md` §2 established for the persona: _"its
 *            schema has no numeric field at all"_. Code renders every figure
 *            the user sees; this stage returns prose about them.
 *
 * INVARIANT: the Zod schemas are the source of truth and the TS types are
 *            derived from them — CLAUDE.md § Conventions.
 *
 * AI-NOTE: adding a NUMERIC field here would not merely widen the schema, it
 *          would delete a guarantee — the guard reads prose, so a number in its
 *          own field routes around it entirely.
 *
 *          Adding a PROSE field is the quieter version of the same mistake, and
 *          it is why `advice.ts` derives the checked string from
 *          `Object.values(result.data)` rather than naming the fields. That
 *          derivation is what makes a new field guarded by default; if anyone
 *          ever replaces it with a hand-written list, this note is the reason
 *          not to.
 */
import { z } from 'zod';

import { MAX_DIET_QUESTION_CHARS } from '../llm/config';

export const dietReplySchema = z.strictObject({
  /**
   * Whether the question is about this person's own diet or training.
   *
   * INVARIANT: declared FIRST, deliberately — the same reason ADR 0015 §3 gives
   *            for the chat. A model generating tokens in order commits to the
   *            classification before it writes the answer, rather than
   *            justifying an answer it has already written. Reordering these
   *            fields is a behavioural change, not a cosmetic one.
   *
   * AI-NOTE: this is the model classifying itself, which is a mitigation and not
   *          a control. What it buys is that the WORDING of a refusal is code.
   *          Do not describe it, in a report or a comment, as confining the
   *          stage.
   */
  on_topic: z.boolean(),

  /**
   * One sentence on what the target is, in plain words and no digits.
   *
   * Split from `caveat` so the guard has two short fields to check rather than
   * one long one, and so the surface can render the second more quietly than
   * the first.
   */
  summary: z.string().min(1).max(300),

  /**
   * The thing worth saying next to the number — that a deficit is modest, that
   * the floor decided it, that training more would move it.
   */
  caveat: z.string().min(1).max(200),
});

export type DietReply = z.infer<typeof dietReplySchema>;

/**
 * The optional free-text question, validated on arrival.
 *
 * INVARIANT: this is the stage's ONLY untrusted input — CLAUDE.md #11. It is
 *            parsed here and fenced in `prompts.ts`; nothing else the model
 *            sees comes from a user.
 */
export const dietQuestionSchema = z
  .string()
  .trim()
  .max(MAX_DIET_QUESTION_CHARS)
  .transform((value) => (value === '' ? null : value));

/**
 * The value that means "no row covers this" — `src/diet/supplements.ts`.
 *
 * WHY a sentinel inside the enum rather than a nullable field: constrained
 * decoding handles a closed set of strings far better than it handles null, and
 * it keeps the whole answer inside one allowlist. `lookUpSupplement` maps it
 * back before anything downstream sees it.
 */
export const NO_MATCH = '__none__';

/**
 * What the supplement lookup may return.
 *
 * INVARIANT: **no text field.** The model's entire output is a slug, so there is
 *            no generated sentence to guard, to discard, or to render by
 *            accident — the strongest form of ADR 0023's retrieval-only shape,
 *            and the reason this is the one stage in the project with no
 *            digit-in-prose problem to have.
 *
 * INVARIANT: the enum is built from the rows ACTUALLY PRESENTED, so a slug the
 *            model invents fails the gateway's own validation and is retried,
 *            rather than reaching `.eq('slug', modelString)` and returning a
 *            silent null. `docs/plans/phase-3.md` states the rule for the
 *            planner — _slug, not free text, and resolved against the candidate
 *            list_ — and this is invariant #5's boundary in another place.
 *
 * `strictObject`, so nothing rides along beside the slug.
 */
export function supplementReplySchema(slugs: readonly string[]) {
  const admitted = [NO_MATCH, ...slugs] as [string, ...string[]];
  return z.strictObject({ slug: z.enum(admitted) });
}
