/**
 * The tonnage comparison ladder.
 *
 * INVARIANT: content lives in the database, not in code — CLAUDE.md #7. This
 *            file reads rows and shapes them; it decides nothing. Which object
 *            a total earns is `compareTonnage` in src/metrics/comparisons.ts,
 *            where it is pure and unit-tested.
 */
import type { Db } from './client';
import type { ComparisonObject } from '../metrics/comparisons';

/**
 * Every shared comparison object, heaviest last.
 *
 * WHY there is no limit and no pagination: the table is authored content with
 * fourteen rows and no path by which a user adds one — `tonnage_comparisons_write`
 * would let somebody insert their own, and nothing in the app offers to. If it
 * ever grows past a page, `compareTonnage` would silently start choosing from a
 * truncated ladder and simply pick a lighter object, which is the kind of wrong
 * that looks right. A row count that approaches PostgREST's `max_rows` is the
 * signal to make this a targeted query rather than to raise a limit.
 *
 * RLS scopes the read to shared rows plus the caller's own (CLAUDE.md #10), so
 * there is no user_id filter to forget.
 */
export async function loadComparisonObjects(db: Db): Promise<ComparisonObject[]> {
  const { data, error } = await db
    .from('tonnage_comparisons')
    .select('slug, singular, plural, mass_kg, source_note')
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
