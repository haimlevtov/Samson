/**
 * Retrieval-only supplement answers — `docs/PRD.md` §5.7, ADR 0023,
 * `docs/specs/diet.md` §4b.
 *
 * INVARIANT: the answer is the ROW, never prose about the row. The model's only
 *            output is a slug from an allowlist built out of the rows it was
 *            shown; code then renders that row's own columns. There is no text
 *            field in the schema, so there is no generated sentence to discard,
 *            to guard, or to render by accident.
 *
 * WHY that shape rather than letting the model summarise: a summary is a new
 * claim, and ADR 0023 is explicit that nobody on this project has read the full
 * text behind these rows. The table's wording was written against the source. A
 * paraphrase of it was not — and a D-graded row, where the evidence does NOT
 * support the popular claim, is exactly the one a fluent paraphrase would
 * soften.
 *
 * WHY this is not a new stage: it is a retrieval step inside the diet stage —
 * one call, one enum field, no prose. `LlmStage` does not grow and no
 * `llm_calls.stage` migration is owed.
 *
 * FOUND IN REVIEW: this file used to hold the schema and the prompt too, on the
 * argument that three files would be ceremony. That was a straw man —
 * `./schema.ts` and `./prompts.ts` already exist, so the skill's layout was also
 * the smaller diff, and no file in `src/` puts a schema, a prompt and a caller
 * in one place. They now live beside `dietReplySchema` and `DIET_SYSTEM`.
 *
 * AI-NOTE: this logs under `stage: 'diet'` and deliberately does not gain a
 *          stage of its own. The cost is real and worth knowing: the per-stage
 *          token breakdown PLAN.md grades now mixes two call shapes under one
 *          label. They are separable in analysis by `prompt_prefix_hash`, which
 *          differs because the system prompts do — the gateway hashes the
 *          preamble plus `system`.
 */
import type { EvidenceRow } from '../db/evidence';
import { SUPPLEMENT_MAX_TOKENS } from '../llm/config';
import type { LlmCaller } from '../planner/types';
import { SUPPLEMENT_SYSTEM, candidatesBlock, supplementQuestionBlock } from './prompts';
import { NO_MATCH, supplementReplySchema } from './schema';

/**
 * What the user reads when the table does not cover the question.
 *
 * INVARIANT: a constant, not a generation. The model cannot author this, cannot
 *            widen it, and cannot append to it — it has no text field at all.
 *
 * The pointer to the whole table is rendered as a LINK beside this by the panel
 * rather than being written into the string, so it is a real anchor rather than
 * the word "Supplements" in prose.
 */
export const NO_MATCH_REPLY =
  'The evidence table does not cover that one. It holds a small, curated set —';

export interface SupplementAnswer {
  /** The row to render, or null when nothing matched. */
  row: EvidenceRow | null;
  /** What to say when `row` is null. Always the constant above. */
  message: string | null;
  costCredits: number;
  modelUsed: string | null;
}

/**
 * Look one question up against the table.
 *
 * INVARIANT: `rows` is whatever `loadEvidence` returned, which is already
 *            scoped by RLS and filtered to shared rows — CLAUDE.md #10. The row
 *            handed back is an object from that same array, never one fetched by
 *            a string the model produced.
 */
export async function lookUpSupplement(
  userId: string,
  rows: readonly EvidenceRow[],
  question: string,
  deps: { call: LlmCaller }
): Promise<SupplementAnswer> {
  /*
   * No rows, no call. `z.enum` cannot be built from an empty list, and paying
   * for a lookup against nothing would be worse than the error. `loadEvidence`
   * already logs when the table comes back empty, which is a migration problem
   * rather than a user-facing one.
   */
  if (rows.length === 0) {
    return { row: null, message: NO_MATCH_REPLY, costCredits: 0, modelUsed: null };
  }

  const result = await deps.call({
    userId,
    stage: 'diet',
    schema: supplementReplySchema(rows.map((row) => row.slug)),
    schemaName: 'supplement_lookup',
    system: SUPPLEMENT_SYSTEM,
    messages: [
      { role: 'user', content: candidatesBlock(rows) },
      { role: 'user', content: supplementQuestionBlock(question) },
    ],
    maxTokens: SUPPLEMENT_MAX_TOKENS,
  });

  const spent = { costCredits: result.costCredits, modelUsed: result.modelUsed };

  /*
   * The sentinel is handled BEFORE the lookup, and it used to be handled by the
   * lookup failing.
   *
   * FOUND IN REVIEW: the comment here said "this find cannot miss", and it
   * misses on every single no-match — that was how `NO_MATCH` became
   * `row: null`. Two things wrong with that. A future editor believing the
   * comment could replace the `?? null` with an assertion and turn the normal
   * path into a throw. And a migration adding a row whose slug is literally
   * `__none__` would shadow the constant: every "the table does not cover that"
   * answer would silently render that row instead.
   */
  if (result.data.slug === NO_MATCH) return { row: null, message: NO_MATCH_REPLY, ...spent };

  /*
   * Resolved against the array that produced the allowlist, not re-queried. The
   * schema has already refused anything outside it, so a miss here means the
   * schema and this array disagree — which fails closed into the constant rather
   * than throwing.
   */
  const row = rows.find((candidate) => candidate.slug === result.data.slug) ?? null;

  return { row, message: row === null ? NO_MATCH_REPLY : null, ...spent };
}
