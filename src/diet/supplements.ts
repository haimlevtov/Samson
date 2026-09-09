/**
 * Retrieval-only supplement answers — `docs/PRD.md` §5.7, ADR 0023.
 *
 * INVARIANT: the answer is the ROW, never prose about the row. The model's only
 *            output is a slug from an allowlist built out of the rows it was
 *            shown; code then renders that row's own columns. There is no text
 *            field in the schema, so there is no generated sentence to discard,
 *            to guard, or to accidentally render.
 *
 * WHY that shape rather than letting the model summarise: a summary is a new
 * claim, and ADR 0023 is explicit that nobody on this project has read the full
 * text behind these rows. The table's wording was written against the source. A
 * paraphrase of it was not — and a D-graded row, where the evidence does NOT
 * support the popular claim, is exactly the one a fluent paraphrase would
 * soften.
 *
 * WHY this is one file rather than the schema/prompts/stage trio in `src/chat/`
 * and `src/persona/`: it is not a new stage. It is a retrieval step inside the
 * diet stage — one call, one enum field, no prose — and three files for it would
 * be ceremony. `.claude/skills/add-pipeline-stage/SKILL.md` describes adding a
 * STAGE, and nothing here adds one.
 *
 * AI-NOTE: this logs under `stage: 'diet'` and deliberately does not gain a
 *          stage of its own, which would need an `llm_calls.stage` migration.
 *          The cost is real and worth knowing: the per-stage token breakdown
 *          PLAN.md grades now mixes two call shapes under one label. They are
 *          separable in analysis by `prompt_prefix_hash`, which differs because
 *          the system prompts differ.
 */
import { z } from 'zod';

import type { EvidenceRow } from '../db/evidence';
import { SUPPLEMENT_MAX_TOKENS } from '../llm/config';
import {
  MAX_FIELD_CHARS,
  MAX_PAYLOAD_CHARS,
  fenceUntrusted,
  sanitizeUntrusted,
} from '../llm/safety';
import type { LlmCaller } from '../planner/types';

/**
 * The value that means "no row covers this".
 *
 * WHY a sentinel in the enum rather than a nullable field: constrained decoding
 * handles a closed set of strings far better than it handles null, and this
 * keeps the whole answer inside one allowlist. Code maps it back to null
 * immediately, so nothing downstream sees the sentinel.
 */
export const NO_MATCH = '__none__';

/**
 * What the user reads when the table does not cover the question.
 *
 * INVARIANT: a constant, not a generation. The model cannot author this, cannot
 *            widen it, and cannot append to it — it has no text field at all.
 */
export const NO_MATCH_REPLY =
  'The evidence table does not cover that one. It holds a small, curated set — the Supplements link above lists every row in it.';

export interface SupplementAnswer {
  /** The row to render, or null when nothing matched. */
  row: EvidenceRow | null;
  /** What to say when `row` is null. Always the constant above. */
  message: string | null;
  costCredits: number;
  modelUsed: string | null;
}

/**
 * WHY the rules are stated here as well as enforced in code: the same reasoning
 * as `CHAT_SYSTEM` and `DIET_SYSTEM` — telling the model raises the first-pass
 * rate, and a first pass that succeeds costs one call instead of two.
 *
 * AI-NOTE: nothing in this string is a control. The control is that the schema
 *          admits only slugs from the list actually sent, so a slug the model
 *          invents fails validation in the gateway rather than reaching a query.
 */
export const SUPPLEMENT_SYSTEM = `You are a lookup. A list of supplement rows follows, each with a slug, a name and the claim the row makes. A question follows it.

Return the slug of the ONE row that answers the question, or "${NO_MATCH}" if none of them does.

Return "${NO_MATCH}" when the question is about a supplement that is not in the list, about something that is not a supplement at all, or about anything other than what these rows cover. A near miss is a miss: do not return the closest row because it is closest.

You write no answer. The application prints the row you name, in the row's own words, and prints a fixed sentence when you name none. Nothing you could write would be shown, so there is nothing to be gained by trying.

Reply with JSON only.`;

const CANDIDATES_LABEL = 'the rows available, as data';
const QUESTION_LABEL = 'the question to look up';

/**
 * The allowlist, and it is the whole mechanism.
 *
 * INVARIANT: built from the rows actually presented — the same boundary
 *            invariant #5 draws for the planner, and the rule
 *            `docs/plans/phase-3.md` states as _"slug, not free text, and
 *            resolved against the candidate list"_. A slug the model invents is
 *            rejected by the gateway's own validation and retried, rather than
 *            reaching `.eq('slug', modelString)` and returning a silent null.
 */
export function supplementReplySchema(rows: readonly EvidenceRow[]) {
  const slugs = [NO_MATCH, ...rows.map((row) => row.slug)] as [string, ...string[]];
  return z.strictObject({ slug: z.enum(slugs) });
}

/**
 * The candidates, as the model sees them.
 *
 * Fenced, and this time the content genuinely is third-party: every claim here
 * paraphrases a source nobody on this project read in full — ADR 0023's whole
 * subject. `sanitizeUntrusted` per field, because one enormous claim would push
 * the rules out of attention on its own.
 */
export function candidatesBlock(rows: readonly EvidenceRow[]): string {
  const candidates = rows.map((row) => ({
    slug: row.slug,
    supplement: sanitizeUntrusted(row.supplement, MAX_FIELD_CHARS),
    claim: sanitizeUntrusted(row.claim, MAX_FIELD_CHARS),
  }));

  return fenceUntrusted(CANDIDATES_LABEL, JSON.stringify(candidates), MAX_PAYLOAD_CHARS);
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
    schema: supplementReplySchema(rows),
    schemaName: 'supplement_lookup',
    system: SUPPLEMENT_SYSTEM,
    messages: [
      { role: 'user', content: candidatesBlock(rows) },
      { role: 'user', content: fenceUntrusted(QUESTION_LABEL, question) },
    ],
    maxTokens: SUPPLEMENT_MAX_TOKENS,
  });

  /*
   * Resolved against the array that produced the allowlist, not re-queried.
   *
   * The schema has already refused anything outside it, so this find cannot
   * miss — but it is written as a lookup rather than an assertion so that a
   * future widening of the schema fails closed here instead of throwing.
   */
  const row = rows.find((candidate) => candidate.slug === result.data.slug) ?? null;

  return {
    row,
    message: row === null ? NO_MATCH_REPLY : null,
    costCredits: result.costCredits,
    modelUsed: result.modelUsed,
  };
}
