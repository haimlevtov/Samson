/**
 * Reading the supplement evidence table.
 *
 * INVARIANT: content lives in the database — CLAUDE.md #7. This file reads rows
 *            and shapes them; what a row MEANS is settled by ADR 0023, and the
 *            rows themselves are in migration 20260909100000.
 */
import { z } from 'zod';
import type { Db } from './client';
import { isDoi } from '../evidence/doi';

export const EVIDENCE_GRADES = ['A', 'B', 'C', 'D'] as const;
export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];

/**
 * Validated on read, and the shape the page consumes is DERIVED from this —
 * CLAUDE.md's "Zod schemas are the single source of truth". The `transform` is
 * what makes that true rather than aspirational: without it, adding a column
 * means editing a schema and an interface and a mapping, and forgetting one of
 * the three is silent.
 *
 * WHY validate a read at all, when nothing can write these rows: the column
 * types allow far more than the contract does — `grade` is `text` with a CHECK,
 * `doi` is `text` with none — and a row written by an older schema still comes
 * back. `src/db/progression.ts` re-parses its jsonb on read for the same reason.
 * (An earlier version of this comment also cited src/db/personas.ts, which
 * casts rather than parses. Corrected in review.)
 */
const rowSchema = z
  .object({
    slug: z.string().min(1),
    supplement: z.string().min(1),
    claim: z.string().min(1),
    grade: z.enum(EVIDENCE_GRADES),
    dose: z.string().nullable(),
    caution: z.string().nullable(),
    doi: z.string().refine(isDoi, 'not a DOI'),
    source_title: z.string().min(1),
    source_year: z.number().int(),
  })
  .transform((row) => ({
    slug: row.slug,
    supplement: row.supplement,
    claim: row.claim,
    grade: row.grade,
    dose: row.dose,
    caution: row.caution,
    doi: row.doi,
    sourceTitle: row.source_title,
    sourceYear: row.source_year,
  }));

export type EvidenceRow = z.infer<typeof rowSchema>;

export interface EvidenceTable {
  rows: EvidenceRow[];
  /**
   * Rows the database returned that did not survive validation.
   *
   * WHY the count is returned AND the failure is logged: they serve different
   * people. The page tells the reader the table is incomplete, because a
   * silently shorter list of health claims is the failure this whole feature
   * argues against. The log tells the maintainer WHICH row and why, because the
   * reader cannot fix a malformed migration and is the only one who was being
   * told. FOUND IN REVIEW — the first version framed these as either/or.
   */
  dropped: number;
}

/**
 * Every shared row, in the order the page shows them.
 *
 * RLS scopes this to shared rows plus the caller's own — CLAUDE.md #10 — and
 * the `is('user_id', null)` filter is belt as well as braces: there is no
 * evidence-authoring feature and no write policy (migration 20260909100000), so
 * a user-owned row should not exist. If one ever does, this page is not where it
 * gets to appear next to a position stand.
 */
export async function loadEvidence(db: Db): Promise<EvidenceTable> {
  const { data, error } = await db
    .from('supplement_evidence')
    .select('slug, supplement, claim, grade, dose, caution, doi, source_title, source_year')
    .is('user_id', null)
    .order('display_order', { ascending: true })
    .order('slug', { ascending: true });

  if (error) throw new Error(`loading supplement evidence: ${error.message}`);

  const returned = data ?? [];
  const rows: EvidenceRow[] = [];

  for (const raw of returned) {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      /*
       * The recovery owner for a malformed health claim is whoever edits the
       * migration, and nothing else would ever tell them. Dropping the row is
       * still right — there is no safe way to render a claim whose grade or
       * citation did not parse, and one bad row must not take out twelve good
       * ones — but dropping it silently was not.
       */
      console.error(
        'evidence row dropped',
        (raw as { slug?: unknown }).slug,
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      );
      continue;
    }

    rows.push(parsed.data);
  }

  if (returned.length === 0) {
    // Zero rows is not an empty state — see the page. The rows ship in a
    // migration, so this means the migration did not run or a policy changed.
    console.error('evidence table returned no rows; the migration ships 13');
  }

  return { rows, dropped: returned.length - rows.length };
}
