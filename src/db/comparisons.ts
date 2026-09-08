/**
 * The tonnage comparison ladder.
 *
 * INVARIANT: content lives in the database, not in code — CLAUDE.md #7. This
 *            file reads rows and shapes them; it decides nothing. Which object
 *            a total earns is `compareTonnage` in src/metrics/comparisons.ts,
 *            where it is pure and unit-tested.
 */
import type { Db } from './client';
import type { ComparisonObject } from '../metrics/types';

/**
 * Every shared comparison object, heaviest last.
 *
 * WHY `is('user_id', null)` rather than leaning on RLS: the read policy admits
 * shared rows OR the caller's own, and this table has no user-authored rows by
 * design — migration 20260908100100 dropped the write policy because there is
 * no feature behind it. Filtering here says that in the query rather than in a
 * comment, and it is what keeps the paragraph below true.
 *
 * FOUND IN REVIEW: the first version said there was "no path by which a user
 * adds one", which was a statement about the UI and not about the security
 * boundary. The write policy granted INSERT to every authenticated session and
 * PostgREST is a path whether or not a button is.
 *
 * WHY there is no limit and no pagination: fourteen authored rows, and now
 * nothing can add a fifteenth without a migration. If the ladder ever grows
 * past a page, `compareTonnage` would silently choose from a truncated one and
 * pick a lighter object — the kind of wrong that looks right. A row count
 * approaching PostgREST's `max_rows` is the signal to make this a targeted
 * query rather than to raise a limit.
 */
export async function loadComparisonObjects(db: Db): Promise<ComparisonObject[]> {
  const { data, error } = await db
    .from('tonnage_comparisons')
    .select('slug, singular, plural, mass_kg, source_note')
    .is('user_id', null)
    .order('mass_kg', { ascending: true });

  if (error) throw new Error(`loading tonnage comparisons: ${error.message}`);

  return (data ?? []).map((row) => ({
    slug: row.slug,
    singular: row.singular,
    plural: row.plural,
    massKg: Number(row.mass_kg),
    sourceNote: row.source_note,
  }));
}
