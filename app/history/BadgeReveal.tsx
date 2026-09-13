import type { UnlockedAchievement } from '@/src/db/gamification';
import { badgeIcon, metalFor } from '@/src/ui/tiers';
import { UnlockSheet } from './UnlockSheet';

/**
 * The badge reveal — PLAN.md phase 4's "a badge visibly fires in the UI on
 * unlock".
 *
 * INVARIANT: the slug arrives in a query parameter, and this component renders
 *            nothing unless that slug matches an achievement_events row the
 *            caller actually holds. RLS scopes that read to the caller, so a
 *            forged parameter reveals nothing — the event has to exist.
 *
 * WHY a query parameter and not a "seen" column: the reveal is a one-shot piece
 * of UI after a redirect, not durable state. A column would need a migration, a
 * write on every page view, and a decision about what "seen" means across
 * devices — all to avoid a parameter that cannot fabricate anything.
 */
export function BadgeReveal({
  slug,
  badges,
}: {
  slug: string | undefined;
  badges: readonly UnlockedAchievement[];
}) {
  if (slug === undefined) return null;

  const badge = badges.find((b) => b.slug === slug);
  if (badge === undefined) return null;

  /*
   * Only what the sheet renders crosses to the client — the holder's own badge,
   * already visible to them on /badges. The metal and icon are chosen here so
   * the client bundle carries no mapping.
   *
   * A held hidden badge is obsidian whatever its tier — ADR 0033 §3.
   */
  return (
    <UnlockSheet
      slug={badge.slug}
      name={badge.name}
      description={badge.description}
      sourceHint={badge.sourceHint}
      hidden={badge.hidden}
      metal={badge.hidden ? 'obsidian' : metalFor(badge.tier)}
      icon={badgeIcon(badge.slug)}
    />
  );
}
