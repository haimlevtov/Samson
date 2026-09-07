/**
 * The leaderboard read. Design and threat model: ADR 0016.
 *
 * INVARIANT: `public.leaderboard` is the security boundary, not this file —
 *            ADR 0016 §1. The view decides who appears and which columns exist;
 *            this maps rows and clamps text for display. A filter added here
 *            would be a boundary the next caller has to remember, which is not
 *            a boundary.
 *
 * INVARIANT: no service role — CLAUDE.md #10. This runs on the caller's client
 *            like every other read in the app; the view is what makes it return
 *            rows the caller does not own.
 */
import type { Db } from './client';

export interface LeaderboardRow {
  rank: number;
  displayName: string;
  lifetimeXp: number;
  /** True for the signed-in user's own row — `auth.uid()`, computed in the view. */
  isYou: boolean;
}

/**
 * How many rows a page asks for.
 *
 * WHY bounded at all: the row count is a population count (ADR 0016, "What this
 * does not guarantee"), and an unbounded select hands the whole cohort over in
 * one request. It is also more names than anybody reads on a phone.
 */
export const LEADERBOARD_LIMIT = 25;

/** Matches the settings form's own cap, so no other route can exceed it. */
const MAX_DISPLAY_NAME = 60;

/**
 * Characters a display name may not contain: C0 and C1 controls, the soft
 * hyphen, and the zero-width and bidirectional-override ranges.
 *
 * WHY a display name gets this when a workout note does not: this is the one
 * string in the app that one user writes and ANOTHER user reads. React escapes
 * it, so there is no markup injection — but a right-to-left override reverses
 * the text after it, and a run of zero-width characters pads one name across
 * other rows. Both vandalise somebody else's screen rather than the author's.
 *
 * AI-NOTE: code points, not a character class, and deliberately so. The same
 *          set written as a regex needs the characters themselves in the
 *          source, where they are invisible in every diff that would have to
 *          approve them and make `grep` treat the file as binary. src/llm/
 *          safety.ts carries the same warning and writes them as escapes;
 *          numbers are the version that cannot be got wrong by a paste.
 */
function isUnsafeDisplayChar(code: number): boolean {
  if (code <= 0x1f) return true; // C0 controls, tab and newline included
  if (code >= 0x7f && code <= 0x9f) return true; // DEL and C1
  if (code === 0x00ad) return true; // soft hyphen
  if (code >= 0x200b && code <= 0x200f) return true; // zero width, LRM/RLM
  if (code >= 0x202a && code <= 0x202e) return true; // bidi embedding/override
  if (code >= 0x2060 && code <= 0x2064) return true; // word joiner, invisibles
  if (code >= 0x2066 && code <= 0x206f) return true; // bidi isolates
  return code === 0xfeff; // byte-order mark
}

export function clampDisplayName(value: string): string {
  const cleaned = [...value]
    .filter((ch) => {
      const code = ch.codePointAt(0);
      return code !== undefined && !isUnsafeDisplayChar(code);
    })
    .join('')
    .trim();

  // Truncated by code point, not by UTF-16 unit: slicing a string mid-surrogate
  // produces a replacement glyph, and an emoji in a name is ordinary.
  const points = [...cleaned];
  return points.length <= MAX_DISPLAY_NAME
    ? cleaned
    : `${points.slice(0, MAX_DISPLAY_NAME).join('')}…`;
}

/**
 * The top of the board, best first.
 *
 * Rank comes from the view rather than the array index: a user outside the
 * limit still has a real position, and computing it here would make the number
 * depend on how many rows this particular call happened to fetch.
 */
export async function loadLeaderboard(
  db: Db,
  limit: number = LEADERBOARD_LIMIT
): Promise<LeaderboardRow[]> {
  const { data, error } = await db
    .from('leaderboard')
    .select('display_name, lifetime_xp, rank, is_you')
    .order('rank', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`loading the leaderboard: ${error.message}`);

  return (data ?? []).flatMap((row) => {
    // The view already excludes null and blank names — ADR 0016 §3. This is the
    // type narrowing that follows from it, not a second filter: a row that
    // reached here without a name means the view changed, and showing one fewer
    // row is better than showing a blank one.
    if (row.display_name === null) return [];

    return [
      {
        rank: row.rank ?? 0,
        displayName: clampDisplayName(row.display_name),
        lifetimeXp: row.lifetime_xp ?? 0,
        isYou: row.is_you ?? false,
      },
    ];
  });
}
