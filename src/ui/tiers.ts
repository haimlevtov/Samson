/**
 * What metal a badge is drawn in, and which icon — ADR 0033 §3.
 *
 * INVARIANT: a DISPLAY mapping. Nothing about earning, ordering or paying for a
 *            badge reads this, and "gold" claims nothing the tier did not
 *            already claim. That is why it is code rather than a column: a
 *            colour is not content (CLAUDE.md #7).
 */
import type { IconName } from './icons';

/** The tiers `achievements_tier_check` allows — the test holds this to the migration. */
export const TIERS = [
  'volume',
  'consistency',
  'comeback',
  'pr',
  'recovery',
  'variety',
  'hidden',
  'calendar',
] as const;

export type Tier = (typeof TIERS)[number];
export type Metal = 'gold' | 'silver' | 'bronze' | 'obsidian';

export const METAL_BY_TIER: Readonly<Record<Tier, Metal>> = {
  pr: 'gold',
  volume: 'gold',
  consistency: 'silver',
  comeback: 'silver',
  recovery: 'bronze',
  variety: 'bronze',
  calendar: 'bronze',
  hidden: 'obsidian',
};

/**
 * The metal for a tier read from the database.
 *
 * WHY bronze for an unknown one: the column is text with a CHECK, so an unknown
 * tier means the CHECK and `TIERS` disagree — which the test catches. At runtime
 * the least prominent metal is the right way to be wrong; gold would be a claim.
 */
export function metalFor(tier: string): Metal {
  return (TIERS as readonly string[]).includes(tier) ? METAL_BY_TIER[tier as Tier] : 'bronze';
}

/**
 * A badge's icon, by slug.
 *
 * Keyed by slug because a slug is stable for life — the add-achievement skill
 * forbids reusing one — and defaulting to `medal` so a new achievement row needs
 * no application change to render.
 */
const ICON_BY_SLUG: Readonly<Record<string, IconName>> = {
  'first-full-week': 'flame',
  'twenty-of-twenty-eight': 'calendar-check',
  'ten-rest-days': 'bed',
  'five-patterns': 'shuffle',
  'hundred-tonnes': 'dumbbell',
  'twenty-percent-up': 'trending-up',
  'three-weeks-away': 'footprints',
  'new-years-day': 'sparkles',
  'one-year-on': 'cake',
  'before-the-birds': 'sunrise',
  'groundhog-set': 'repeat',
};

export function badgeIcon(slug: string): IconName {
  return ICON_BY_SLUG[slug] ?? 'medal';
}

/** For the test: the slugs this file has an opinion about. */
export const SLUGS_WITH_ICONS = Object.keys(ICON_BY_SLUG);
