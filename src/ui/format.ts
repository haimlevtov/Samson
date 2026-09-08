/**
 * Display formatting.
 *
 * INVARIANT: values are stored canonically and converted at display only —
 *            CLAUDE.md #8. Dates follow the same rule as units: `YYYY-MM-DD`
 *            everywhere in the database, in the metrics engine and on the wire,
 *            reformatted here and nowhere else.
 *
 * WHY these split the string rather than going through `new Date(...)`: a local
 * Date constructed from a bare date string is midnight UTC, which renders as the
 * *previous day* for anyone west of Greenwich. The stored value is already the
 * user's local date (CLAUDE.md #9) — it is a label, not an instant, and must
 * never be round-tripped through a timezone to be displayed.
 */
import type { TonnageComparison } from '../metrics/comparisons';
import type { LocalDate } from '../metrics/types';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-08-25` → `25/08/2026`. Returns the input unchanged if it is not a date. */
export function displayDate(date: LocalDate | null | undefined): string {
  if (!date) return '—';
  const match = ISO_DATE.exec(date);
  if (!match) return date;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/** `2026-08-25` → `25/08`. For axes and narrow columns where the year is noise. */
export function displayShortDate(date: LocalDate | null | undefined): string {
  if (!date) return '—';
  const match = ISO_DATE.exec(date);
  if (!match) return date;
  const [, , month, day] = match;
  return `${day}/${month}`;
}

/**
 * `{ count: 3, object: bus }` → `3 double-decker buses`.
 *
 * WHY the singular carries its own article and this does not add one: "a
 * double-decker bus" and "the Statue of Liberty" do not take the same word, and
 * a rule in code for choosing between them would be a second thing to get wrong
 * about a row that is already content — see the migration.
 *
 * INVARIANT: the number arrives already computed by `compareTonnage` —
 *            CLAUDE.md #1. This function does no arithmetic beyond deciding
 *            which of two authored strings to print.
 */
export function comparisonPhrase(comparison: TonnageComparison): string {
  const { count, object } = comparison;
  return count === 1 ? object.singular : `${count.toLocaleString()} ${object.plural}`;
}
