/**
 * Where a popover has to move to stay on screen — ADR 0022.
 *
 * WHY this is a separate file from FieldHint.tsx: the component needs a DOM to
 * measure, and `vitest.config.ts` runs in `environment: 'node'` over `src/**` on
 * purpose. The part that can be arithmetically wrong is pure, so it lives here
 * and is tested here — the same split as `src/ui/tabs.ts`, and for the reason
 * that file's docstring gives: the failure is silent and renders perfectly.
 */

/** Breathing room kept between a popover and either edge of the viewport. */
export const EDGE_GUTTER = 8;

/** The horizontal extent of a popover, in viewport coordinates. */
export interface HorizontalExtent {
  left: number;
  right: number;
}

/**
 * How far to move `extent` horizontally so it sits inside `viewportWidth`.
 *
 * Returns 0 when it already fits, so a popover the stylesheet placed correctly
 * is left exactly where it was.
 *
 * The sign is NOT one-directional, which is the thing to know before editing:
 * overhanging the right gives a negative shift, but a popover whose left edge is
 * already off-screen — which the centred rule at `min-width: 760px` can produce,
 * since it pulls the bubble left by half its own width — gives a positive one.
 * The left edge wins when both apply, because text that has scrolled off the
 * left is unreadable whereas the right merely scrolls.
 *
 * AI-NOTE: this cannot see the viewport or the element. Anything that needs the
 *          DOM belongs in the caller, so that this stays testable without one.
 */
export function computeHintShift(
  extent: HorizontalExtent,
  viewportWidth: number,
  gutter: number = EDGE_GUTTER
): number {
  const overhang = viewportWidth - gutter - extent.right;
  let shift = Math.min(0, overhang);

  if (extent.left + shift < gutter) shift = gutter - extent.left;

  return Math.round(shift);
}
