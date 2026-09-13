import type { UnlockedAchievement } from '@/src/db/gamification';
import { unlockSheetProps } from '@/src/ui/unlock';
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
  // The gate and the field list are `unlockSheetProps`, tested in src/ui/unlock.test.ts.
  const props = unlockSheetProps(slug, badges);
  if (props === null) return null;

  // Keyed by slug, so a different badge is a fresh sheet rather than a closed one.
  return <UnlockSheet key={props.slug} {...props} />;
}
