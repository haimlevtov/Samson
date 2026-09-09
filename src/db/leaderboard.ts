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
import { levelForXp } from '../gamification/level';
import { stripInvisible } from '../llm/safety';
import type { Db } from './client';

export interface LeaderboardRow {
  rank: number;
  displayName: string;
  /**
   * The figure the board shows — `levelForXp(lifetimeXp)`.
   *
   * INVARIANT: derived here, in TypeScript, from the XP the view returns —
   *            never computed in SQL. `src/gamification/level.ts` is the single
   *            definition of the curve, including the per-step rounding whose
   *            AI-NOTE explains why a closed-form sum drifts at the edges. A
   *            second copy in a view would be the failure this repo has now
   *            recorded three times: a badge and a chart disagreeing about one
   *            set, the seeder recounting sessions, and `sessions_last_28_days`.
   */
  level: number;
  /**
   * Still carried, and still what `rank` is ordered by.
   *
   * WHY it is kept when the board no longer prints it: it is the tiebreak. Level
   * buckets XP, so a level-only ordering would put a third of the table on one
   * rank; ADR 0016's amendment records the decision to keep a total order and
   * show the level. Rendering this is the caller's choice — the Hub does not.
   */
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

/**
 * The longest a display name may be, in code points.
 *
 * INVARIANT: one definition — the settings form validates against this same
 *            constant and the database enforces it as a CHECK. Three copies of
 *            a bound is two that drift.
 */
export const MAX_DISPLAY_NAME = 60;

/**
 * How many combining marks may follow one base character.
 *
 * WHY there is a cap at all — FOUND IN REVIEW, 2026-09-07: combining marks are
 * legal, ordinary characters in many scripts, so they cannot simply be
 * stripped. But they stack VERTICALLY, and 59 of them on one base character is
 * a legal 60-character name that grows one row of the table on every other
 * user's screen. `.lb-name` defends the horizontal axis; nothing defended this
 * one.
 *
 * Two is enough for the real cases this has to keep working — a Vietnamese
 * vowel with tone, a Hebrew letter with niqqud and a cantillation mark.
 */
const MAX_COMBINING_RUN = 2;

/** U+0300 and the other combining blocks, which stack rather than advance. */
function isCombiningMark(code: number): boolean {
  if (code >= 0x0300 && code <= 0x036f) return true; // diacriticals
  if (code >= 0x0483 && code <= 0x0489) return true; // Cyrillic
  if (code >= 0x0591 && code <= 0x05bd) return true; // Hebrew points
  if (code >= 0x0610 && code <= 0x061a) return true; // Arabic
  if (code >= 0x064b && code <= 0x065f) return true; // Arabic
  if (code >= 0x1ab0 && code <= 0x1aff) return true; // extended
  if (code >= 0x1dc0 && code <= 0x1dff) return true; // supplement
  if (code >= 0x20d0 && code <= 0x20f0) return true; // for symbols
  return code >= 0xfe20 && code <= 0xfe2f; // half marks
}

/**
 * A display name, safe to render beside other people's.
 *
 * WHY the invisible/control set comes from `src/llm/safety.ts` rather than
 * being written again here — FOUND IN REVIEW, 2026-09-07: it WAS written again
 * here, code point by code point, as a second copy of ranges that already
 * existed and were already tested. A security-relevant character set with two
 * definitions has one that is out of date.
 *
 * Tab and newline are flattened on top of it, which `stripInvisible`
 * deliberately keeps: a workout note may contain both, and a name rendered into
 * one table cell may not — a newline there is a name occupying two rows.
 *
 * Everything becomes a SPACE rather than nothing, matching how `stripInvisible`
 * treats a control character: deleting it would glue two words into one and
 * quietly change how somebody's name reads. Runs then collapse to a single
 * space, which also means padding a name with whitespace buys no width.
 */
export function clampDisplayName(value: string): string {
  const flattened = stripInvisible(value).replace(/\s+/g, ' ');

  const kept: string[] = [];
  let combiningRun = 0;

  for (const ch of flattened) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;

    if (isCombiningMark(code)) {
      // Past the cap the marks are dropped and the base character stays, so a
      // name that is mostly legitimate survives with its accents.
      if (combiningRun >= MAX_COMBINING_RUN) continue;
      combiningRun += 1;
    } else {
      combiningRun = 0;
    }

    kept.push(ch);
  }

  const cleaned = kept.join('').trim();

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
 *
 * **The view is untouched by the move to levels**, and that is the point. Rank
 * is still `rank() over (order by xp desc, display_name asc)`, so the ordering
 * is unchanged — `levelForXp` is monotonic non-decreasing, so an XP ordering
 * never puts a lower level above a higher one. What changed is the figure a
 * reader sees, which is a mapping and not a query.
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
    // The view already excludes null and blank names — ADR 0016 §3.
    if (row.display_name === null) return [];

    const displayName = clampDisplayName(row.display_name);

    /*
     * A name that is empty AFTER clamping is dropped, so the boundary and the
     * renderer agree on what "has a name" means.
     *
     * FOUND IN REVIEW, 2026-09-07: they did not. The view's original check was
     * `btrim(x) <> ''`, which strips ASCII space and nothing else, so a tab or
     * a non-breaking space took a numbered slot and rendered as a blank row.
     * The hardening migration fixes the view; this makes the page fail the same
     * way if a future edit ever loosens it again.
     */
    if (displayName === '') return [];

    const lifetimeXp = row.lifetime_xp ?? 0;

    return [
      {
        rank: row.rank ?? 0,
        displayName,
        // INVARIANT: the level is code's, not SQL's — see LeaderboardRow.
        level: levelForXp(lifetimeXp),
        lifetimeXp,
        isYou: row.is_you ?? false,
      },
    ];
  });
}
