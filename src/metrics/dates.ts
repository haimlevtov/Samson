/**
 * Arithmetic on local calendar dates.
 *
 * WHY: every function here operates on `YYYY-MM-DD` strings through UTC, never
 *      through a local Date constructor. `new Date('2026-03-29')` in a timezone
 *      with a DST transition can land on the previous day, which would silently
 *      shift a workout between weeks and corrupt adherence and ACWR windows.
 *      The date is already local by the time it reaches us — CLAUDE.md #9 — so
 *      it must be treated as a label, not as an instant.
 */
import type { LocalDate } from './types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function isLocalDate(value: string): value is LocalDate {
  if (!DATE_PATTERN.test(value)) return false;
  return toEpochDay(value) !== null;
}

/** Days since the epoch, or null when the string is not a real calendar date. */
function toEpochDay(date: LocalDate): number | null {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  if (Number.isNaN(ms)) return null;
  const back = new Date(ms);
  // Rejects 2026-02-30 and friends, which Date.UTC silently rolls forward.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms / MS_PER_DAY;
}

function requireEpochDay(date: LocalDate): number {
  const day = toEpochDay(date);
  if (day === null) throw new RangeError(`not a calendar date: ${date}`);
  return day;
}

function fromEpochDay(day: number): LocalDate {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(requireEpochDay(date) + days);
}

/** Positive when `a` is later than `b`. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return requireEpochDay(a) - requireEpochDay(b);
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return requireEpochDay(a) - requireEpochDay(b);
}

/**
 * Inclusive of both ends.
 * WHY: windows are expressed as "the 7 days ending today", so both the first and
 *      last day count. An exclusive end would quietly drop today's session.
 */
export function isWithin(date: LocalDate, start: LocalDate, end: LocalDate): boolean {
  const day = requireEpochDay(date);
  return day >= requireEpochDay(start) && day <= requireEpochDay(end);
}

/**
 * The Monday on or before `date`.
 * WHY: ISO weeks. The weekly XP ceiling and weekly tonnage must agree on where a
 *      week starts, and storing it (xp_events.week_start) means it cannot drift.
 */
export function startOfWeek(date: LocalDate): LocalDate {
  const day = requireEpochDay(date);
  // 1970-01-01 was a Thursday, so shift by 4 to make Monday the zero point.
  const weekday = (((day + 3) % 7) + 7) % 7;
  return fromEpochDay(day - weekday);
}

/** Every date from `start` to `end` inclusive, ascending. */
export function eachDay(start: LocalDate, end: LocalDate): LocalDate[] {
  const from = requireEpochDay(start);
  const to = requireEpochDay(end);
  if (to < from) return [];
  const out: LocalDate[] = [];
  for (let day = from; day <= to; day++) out.push(fromEpochDay(day));
  return out;
}

/**
 * Today, as the user's calendar sees it.
 *
 * INVARIANT: calendar logic evaluates against the user's local date, never the
 *            server's — CLAUDE.md #9. A session logged at 23:30 in Jerusalem
 *            belongs to that day; a challenge window written from a UTC date is
 *            a window judged against a date it was not measured in.
 *
 * WHY it lives here rather than beside each caller: there were two definitions
 * of it — one in `scripts/generate-challenges.ts` and one in `src/db/server.ts`
 * — and they disagreed about an unparseable timezone. This is the single one,
 * and `localDateFor` now delegates.
 *
 * An unknown IANA zone falls back to UTC rather than throwing. The `users`
 * table has a CHECK that validates the zone (20260908090300), so the fallback
 * should be unreachable; it exists because the alternative in a batch that
 * walks every user is one bad row ending everybody else's run.
 */
export function localDateIn(timezone: string, now: Date = new Date()): LocalDate {
  const format = (zone: string): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

  try {
    return format(timezone) as LocalDate;
  } catch {
    return format('UTC') as LocalDate;
  }
}
