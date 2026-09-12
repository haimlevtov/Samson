/**
 * Which tab a path belongs to.
 *
 * Pure, and in its own module so it can be tested without React, Next or a
 * DOM — the same reasoning that keeps `src/metrics/` free of I/O. `TabBar.tsx`
 * is a client component and importing it into a unit test drags the framework
 * in behind it.
 */

/**
 * The five tab routes, in markup order — ADR 0012.
 *
 * INVARIANT: this is the only list of them. `TabBar.tsx` builds its links from
 *            it and `tabs.test.ts` validates `OWNED_BY` against it, so a
 *            renamed route breaks both at once instead of silently orphaning
 *            an OWNED_BY entry while every test stays green.
 *
 * WHY here and not in TabBar.tsx: a test that imports the component drags React
 * and Next in behind it. The data belongs with the predicate that reads it.
 */
export const TAB_HREFS = ['/history', '/coach', '/hub', '/workout', '/profile'] as const;

export type TabHref = (typeof TAB_HREFS)[number];

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
export const OWNED_BY: Record<string, TabHref> = {
  '/settings': '/profile',
  // ADR 0020. Reached from Profile, not from the tab bar — five tabs is the
  // budget ADR 0012 set. FOUND IN REVIEW: shipped without this entry, so the
  // page lit no tab at all, which is precisely what the AI-NOTE above warns
  // about. It also kept the route out of the orphan-link guard in
  // tests/unit/invariants.test.ts, which iterates these keys — so the page that
  // documents "the link on Profile is the only way in" was the one page nothing
  // checked had a link.
  '/progression-trees': '/profile',
  // ADR 0017's 2026-09-12 amendment. Reached from Profile's Badges section, for
  // the reason the entry above gives.
  '/badges': '/profile',
  // ADR 0023. Reached from Coach, which is where a supplement question gets
  // asked, and for the same reason as the entry above: five tabs is the budget.
  '/evidence': '/coach',
};

/** True when `pathname` is `route` or sits underneath it. */
function isUnder(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** How a path relates to a tab. `null` means the tab is not lit at all. */
export type TabMatch = 'page' | 'owned' | null;

/**
 * A tab is lit when the path is it, lives under it, or is claimed by it in
 * `OWNED_BY` — so the session screen at `/history/[id]` keeps History lit, and
 * `/settings` keeps Profile lit, rather than lighting nothing.
 *
 * The two cases are distinguished because `aria-current` needs them to be.
 * `/history/[id]` IS a History page, so `aria-current="page"` is true. But
 * `/settings` is not a Profile page — its heading says Settings — and telling a
 * screen-reader user they are on Profile is simply wrong. Owned routes get
 * `aria-current="true"`, which says "this is the current one of these" without
 * claiming to be the page.
 */
export function tabMatch(pathname: string, href: string): TabMatch {
  if (isUnder(pathname, href)) return 'page';

  const owner = Object.entries(OWNED_BY).find(([route]) => isUnder(pathname, route));
  return owner?.[1] === href ? 'owned' : null;
}

/** Whether the tab is lit at all, for callers that do not care which way. */
export function isCurrent(pathname: string, href: string): boolean {
  return tabMatch(pathname, href) !== null;
}
