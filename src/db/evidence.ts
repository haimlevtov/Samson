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
 * Validated on READ as well as on write, the same call src/db/personas.ts and
 * src/db/progression.ts make: the column types allow more than the contract
 * does, and a row written by an older schema still comes back.
 *
 * A row that fails to parse is DROPPED rather than rendered, which is the
 * opposite of the choice ADR 0020 made for progression nodes — and deliberately
 * so. A node that fails to parse can be shown locked, because "you have not
 * unlocked this" is a safe thing to say. There is no safe way to show a health
 * claim whose grade or citation did not survive validation; a missing row is
 * honest and a malformed one is not.
 */
const rowSchema = z.object({
  slug: z.string().min(1),
  supplement: z.string().min(1),
  claim: z.string().min(1),
  grade: z.enum(EVIDENCE_GRADES),
  dose: z.string().nullable(),
  caution: z.string().nullable(),
  doi: z.string().refine(isDoi, 'not a DOI'),
  source_title: z.string().min(1),
  source_year: z.number().int(),
  display_order: z.number().int(),
});

export interface EvidenceRow {
  slug: string;
  supplement: string;
  claim: string;
  grade: EvidenceGrade;
  dose: string | null;
  caution: string | null;
  doi: string;
  sourceTitle: string;
  sourceYear: number;
}

export interface EvidenceTable {
  rows: EvidenceRow[];
  /**
   * Rows the database returned that did not survive validation.
   *
   * WHY it is returned rather than logged: the page tells the reader the table
   * is incomplete. A supplement page silently missing a row is the failure mode
   * this whole feature is arguing against — see ADR 0023 on rows that look
   * checked.
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
    .select(
      'slug, supplement, claim, grade, dose, caution, doi, source_title, source_year, display_order'
    )
    .is('user_id', null)
    .order('display_order', { ascending: true })
    .order('slug', { ascending: true });

  if (error) throw new Error(`loading supplement evidence: ${error.message}`);

  const returned = data ?? [];
  const rows: EvidenceRow[] = [];

  for (const raw of returned) {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) continue;

    const row = parsed.data;
    rows.push({
      slug: row.slug,
      supplement: row.supplement,
      claim: row.claim,
      grade: row.grade,
      dose: row.dose,
      caution: row.caution,
      doi: row.doi,
      sourceTitle: row.source_title,
      sourceYear: row.source_year,
    });
  }

  return { rows, dropped: returned.length - rows.length };
}
