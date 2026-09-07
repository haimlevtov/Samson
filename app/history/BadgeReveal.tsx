import Link from 'next/link';
import type { UnlockedAchievement } from '@/src/db/gamification';

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

  return (
    <div className="badge-reveal" role="status" aria-live="polite">
      <div className="badge-reveal-mark" aria-hidden="true">
        ★
      </div>
      <div className="badge-reveal-body">
        <p className="badge-reveal-kicker">Achievement unlocked</p>
        <h2>{badge.name}</h2>
        <p className="muted small">{badge.description}</p>
      </div>
      {/* Badges live on Profile since ADR 0013. This link followed them. */}
      <Link href="/profile" className="chip">
        All badges
      </Link>
    </div>
  );
}
