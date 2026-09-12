/**
 * The badge catalogue, shaped — coach-memory PR 7, ADR 0017's 2026-09-12 amendment.
 *
 * Pure: the rows come in, the catalogue goes out. The reads are in
 * `src/db/gamification.ts`; the rules about what a person is shown are here,
 * where a test can hold them without a database.
 *
 * INVARIANT: this never RECEIVES a locked hidden definition, so it cannot leak
 *            one. `achievements_read_visible` withholds those rows before they
 *            leave Postgres, `unlocked_achievements()` returns only what the
 *            caller holds, and the count of the rest arrives as one integer.
 *            Nothing here filters hidden rows OUT — relying on it would make a
 *            function the control ADR 0017 put in a policy.
 */
import { HUMOR_LEVELS, HUMOR_ORDER, type HumorLevel } from '../persona/schema';

/** A badge the user holds. `description` is the reward copy, written for them. */
export interface EarnedBadge {
  slug: string;
  name: string;
  description: string;
  tier: string;
  hidden: boolean;
  sourceHint: string | null;
  /** The user's local date on the day it was earned. */
  earnedOn: string;
}

/** A badge the user does not hold. `howToEarn` is the condition, for them. */
export interface BadgeToGet {
  slug: string;
  name: string;
  howToEarn: string;
  tier: string;
}

export interface Catalogue {
  earned: EarnedBadge[];
  toGet: BadgeToGet[];
  /**
   * Hidden badges the user has not earned. A number, and nothing else — or null
   * when the count that arrived was not one, in which case nothing is said.
   */
  hiddenRemaining: number | null;
  /**
   * Visible badges not held and above the user's humour setting — counted, not
   * named, for the same reason the hidden ones are: a list that silently drops
   * rows reads as complete.
   */
  aboveCeiling: number;
}

/** A shared, visible badge as the policy returns it — never with `predicate`. */
export interface VisibleRow {
  slug: string;
  name: string;
  howToEarn: string;
  tier: string;
  /** Text in the database, so not trusted to be one of the three. */
  humorLevel: string;
}

/** A held badge as `unlocked_achievements()` returns it, hidden ones included. */
export interface HeldRow {
  slug: string;
  name: string;
  description: string;
  tier: string;
  hidden: boolean;
  sourceHint: string | null;
  localDate: string;
  /** The instant it was earned — the order, where `localDate` is the label. */
  unlockedAt: string;
}

/**
 * The user's humour setting as a ceiling. Absent or unrecognised is `clean`.
 *
 * WHY the strictest rather than the column default: this gates what an UNEARNED
 * badge may say to somebody, and a value nobody could read is not consent to
 * `cheeky`. That only holds end to end because `loadBadgeCatalogue` reads the
 * setting itself and passes null for a missing row — `currentUser` substitutes
 * `cheeky` for a failed read, which is why the page does not pass its value.
 * FOUND IN REVIEW: the first version did, and this comment was not true.
 */
export function humorCeiling(value: string | null): HumorLevel {
  return value !== null && (HUMOR_LEVELS as readonly string[]).includes(value)
    ? (value as HumorLevel)
    : 'clean';
}

/**
 * Builds the catalogue from what the database was willing to send.
 *
 * EARNED is everything held, hidden or not — a person is always shown what they
 * have, which is the failure ADR 0017 was written to end. Newest first: the one
 * you just got is the one you came to look at. Ordered by the INSTANT, not the
 * local date — two badges earned on one day would otherwise sort by name, and a
 * change of timezone can put a later unlock on an earlier date.
 *
 * TO GET is every visible badge not held, AT OR BELOW THE USER'S HUMOUR CEILING.
 * This is the first surface to show UNEARNED names, so it is the first place a
 * ceiling applies to a badge rather than to a persona. It is not hypothetical:
 * four shipped achievements are `cheeky`, so somebody who chose `clean` does
 * not see them until they earn one. _An earlier version of this comment said the
 * filter "removes nothing yet"; review counted._ What it removes is counted in
 * `aboveCeiling` and said on the page.
 *
 * A row whose level is not one of the three is left out and counted with them:
 * `indexOf` returns -1 for it, which is below every ceiling, so without the
 * explicit check an unreadable level would be the one level shown to everybody.
 */
export function buildCatalogue(input: {
  visible: readonly VisibleRow[];
  held: readonly HeldRow[];
  hiddenRemaining: number | null;
  humorCeiling: HumorLevel;
}): Catalogue {
  const heldSlugs = new Set(input.held.map((row) => row.slug));
  const ceiling = HUMOR_ORDER.indexOf(input.humorCeiling);

  const earned: EarnedBadge[] = [...input.held]
    // Parsed, not compared as text: Postgres trims trailing zeros from the
    // fractional seconds, so two instants are not the same width. An unparseable
    // one is NaN, which is falsy, and falls through to the name.
    .sort(
      (a, b) => Date.parse(b.unlockedAt) - Date.parse(a.unlockedAt) || a.name.localeCompare(b.name)
    )
    .map((row) => ({
      slug: row.slug,
      name: row.name,
      description: row.description,
      tier: row.tier,
      hidden: row.hidden,
      sourceHint: row.sourceHint,
      earnedOn: row.localDate,
    }));

  const unheld = input.visible.filter((row) => !heldSlugs.has(row.slug));
  const allowed = unheld.filter((row) => {
    const level = HUMOR_ORDER.indexOf(row.humorLevel as HumorLevel);
    return level !== -1 && level <= ceiling;
  });

  const toGet: BadgeToGet[] = allowed
    .map((row) => ({
      slug: row.slug,
      name: row.name,
      howToEarn: row.howToEarn,
      tier: row.tier,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    earned,
    toGet,
    /*
     * The function returns a non-negative integer. Anything else is not a count,
     * and becomes null rather than 0 — FOUND IN REVIEW: 0 renders "You found
     * every hidden badge" for somebody holding one, a positive claim built from
     * a value that could not be read.
     */
    hiddenRemaining:
      input.hiddenRemaining !== null &&
      Number.isInteger(input.hiddenRemaining) &&
      input.hiddenRemaining >= 0
        ? input.hiddenRemaining
        : null,
    aboveCeiling: unheld.length - allowed.length,
  };
}

/**
 * The line for badges above the user's humour setting — mobile-interface §4.
 * It names the setting, because that is what somebody can change.
 */
export function aboveCeilingLine(n: number): string {
  return n === 1
    ? '1 more badge is above your humour setting.'
    : `${n} more badges are above your humour setting.`;
}

/**
 * The line under the hidden count — ADR 0017's amendment, and the three states
 * `docs/specs/mobile-interface.md` §4 names. Null when nothing should render.
 *
 * WHY "you found every hidden badge" needs a held one: a count of zero means
 * either every hidden badge is found or none exist, and only the first is a
 * thing to congratulate somebody on.
 */
export function hiddenLine(catalogue: Catalogue): string | null {
  const n = catalogue.hiddenRemaining;
  if (n === null) return null;
  if (n === 1) return '1 hidden badge left to find.';
  if (n > 1) return `${n} hidden badges left to find.`;
  return catalogue.earned.some((badge) => badge.hidden) ? 'You found every hidden badge.' : null;
}
