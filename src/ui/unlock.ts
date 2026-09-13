/**
 * The decisions behind the badge unlock sheet — pure, so they are tested.
 *
 * FOUND IN REVIEW of the Quest Log's PR 3: the gate, the fields that cross to the
 * browser and the URL cleanup lived in components nothing tests, because nothing
 * under `app/` is in the unit suite.
 */
import type { UnlockedAchievement } from '../db/gamification';
import type { IconName } from './icons';
import { badgeIcon, metalFor, type Metal } from './tiers';

/** Exactly what the sheet renders, and nothing else crosses to the client. */
export interface UnlockSheetProps {
  slug: string;
  name: string;
  description: string;
  sourceHint: string | null;
  hidden: boolean;
  metal: Metal;
  icon: IconName;
}

/**
 * The sheet's props for `?unlocked=`, or null when nothing should show.
 *
 * INVARIANT: the slug only SELECTS — it renders nothing unless it matches a badge
 *            the caller holds, and `badges` is the caller's own, RLS-scoped. A
 *            forged slug, a repeated parameter (which arrives as an array) or no
 *            parameter shows nothing.
 *
 * A held hidden badge is obsidian whatever its tier — ADR 0033 §3.
 */
export function unlockSheetProps(
  slug: unknown,
  badges: readonly UnlockedAchievement[]
): UnlockSheetProps | null {
  if (typeof slug !== 'string') return null;
  const badge = badges.find((b) => b.slug === slug);
  if (badge === undefined) return null;
  return {
    slug: badge.slug,
    name: badge.name,
    description: badge.description,
    sourceHint: badge.sourceHint,
    hidden: badge.hidden,
    metal: badge.hidden ? 'obsidian' : metalFor(badge.tier),
    icon: badgeIcon(badge.slug),
  };
}

/** `href` with `unlocked` removed and everything else — path, other params, hash — kept. */
export function withoutUnlocked(href: string): string {
  const url = new URL(href, 'http://local');
  url.searchParams.delete('unlocked');
  return url.pathname + url.search + url.hash;
}

/**
 * Where Tab moves inside a modal of `count` controls, from index `at` (-1 when
 * focus is outside it). Wraps at both ends.
 */
export function nextFocusIndex(at: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (backwards) return at <= 0 ? count - 1 : at - 1;
  return at < 0 || at >= count - 1 ? 0 : at + 1;
}
