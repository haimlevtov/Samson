/**
 * The badge catalogue, shaped — rework PR 7, ADR 0017's 2026-09-12 amendment.
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
  /** Hidden badges the user has not earned. A number, and nothing else. */
  hiddenRemaining: number;
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
}

/**
 * The user's humour setting as a ceiling. Anything unrecognised is `clean`.
 *
 * WHY the strictest rather than the default: this gates what an UNEARNED badge
 * may say to somebody, and a value nobody can read is not consent to `cheeky`.
 */
export function humorCeiling(value: string): HumorLevel {
  return (HUMOR_LEVELS as readonly string[]).includes(value) ? (value as HumorLevel) : 'clean';
}

/**
 * Builds the catalogue from what the database was willing to send.
 *
 * EARNED is everything held, hidden or not — a person is always shown what they
 * have, which is the failure ADR 0017 was written to end. Newest first: the one
 * you just got is the one you came to look at.
 *
 * TO GET is every visible badge not held, AT OR BELOW THE USER'S HUMOUR CEILING.
 * This is the first surface to show UNEARNED names, so it is the first place a
 * ceiling applies to a badge rather than to a persona. Every shipped achievement
 * is `clean` or `cheeky` today, so this removes nothing yet — but a future
 * `crude` row would otherwise reach somebody who chose `clean`. A row whose
 * level is not one of the three is left out: `indexOf` returns -1 for it, which
 * is below every ceiling, so without the explicit check an unreadable level
 * would be the one level shown to everybody.
 */
export function buildCatalogue(input: {
  visible: readonly VisibleRow[];
  held: readonly HeldRow[];
  hiddenRemaining: number;
  humorCeiling: HumorLevel;
}): Catalogue {
  const heldSlugs = new Set(input.held.map((row) => row.slug));
  const ceiling = HUMOR_ORDER.indexOf(input.humorCeiling);

  const earned: EarnedBadge[] = input.held
    .map((row) => ({
      slug: row.slug,
      name: row.name,
      description: row.description,
      tier: row.tier,
      hidden: row.hidden,
      sourceHint: row.sourceHint,
      earnedOn: row.localDate,
    }))
    .sort((a, b) => b.earnedOn.localeCompare(a.earnedOn) || a.name.localeCompare(b.name));

  const toGet: BadgeToGet[] = input.visible
    .filter((row) => !heldSlugs.has(row.slug))
    .filter((row) => {
      const level = HUMOR_ORDER.indexOf(row.humorLevel as HumorLevel);
      return level !== -1 && level <= ceiling;
    })
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
    // The function returns an integer; a malformed one must not render as
    // "-1 hidden badges" or "NaN hidden badges".
    hiddenRemaining: Number.isFinite(input.hiddenRemaining)
      ? Math.max(0, Math.floor(input.hiddenRemaining))
      : 0,
  };
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
  if (n === 1) return '1 hidden badge left to find.';
  if (n > 1) return `${n} hidden badges left to find.`;
  return catalogue.earned.some((badge) => badge.hidden) ? 'You found every hidden badge.' : null;
}
