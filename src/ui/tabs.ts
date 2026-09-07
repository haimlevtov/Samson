/**
 * Which tab a path belongs to.
 *
 * Pure, and in its own module so it can be tested without React, Next or a
 * DOM — the same reasoning that keeps `src/metrics/` free of I/O. `TabBar.tsx`
 * is a client component and importing it into a unit test drags the framework
 * in behind it.
 */

/**
 * Routes that belong to a tab without living under its path.
 *
 * WHY this exists rather than nesting the route: `/settings` is where people
 * expect settings to be, and it is short enough to say out loud. Nesting it at
 * `/profile/settings` would light the tab for free, but at the cost of the
 * address — and ADR 0013's amendment moved settings to a route precisely so it
 * would have a good one.
 *
 * AI-NOTE: any future top-level route that is really part of a tab goes here.
 *          Leaving it out lights no tab at all, which is the exact failure
 *          `isCurrent` was written to prevent.
 */
export const OWNED_BY: Record<string, string> = {
  '/settings': '/profile',
};

/** True when `pathname` is `route` or sits underneath it. */
function isUnder(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * A tab is current when the path is it, lives under it, or is claimed by it in
 * `OWNED_BY` — so the session screen at `/history/[id]` keeps History lit, and
 * `/settings` keeps Profile lit, rather than lighting nothing.
 */
export function isCurrent(pathname: string, href: string): boolean {
  if (isUnder(pathname, href)) return true;

  const owner = Object.entries(OWNED_BY).find(([route]) => isUnder(pathname, route));
  return owner?.[1] === href;
}
