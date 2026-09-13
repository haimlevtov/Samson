/**
 * How a segmented meter fills — the Quest Log redesign, ADR 0033 §5.
 *
 * INVARIANT: this divides a figure that `src/gamification/` already produced
 *            into segments for drawing. It makes no rule about XP or progress,
 *            and nothing reads its output but CSS.
 */

/**
 * The most segments a meter draws. A challenge with a larger target keeps the
 * continuous `.xp-meter`: past ten, segments stop being countable at a glance,
 * which is the only reason to draw them.
 */
export const MAX_SEGMENTS = 10;

/**
 * Each segment's fill, from 0 to 1, for `value` out of `total` drawn as
 * `count` segments. A challenge passes its target as both `total` and
 * `count`, so each segment is one unit; the weekly XP meter passes ten.
 *
 * Out-of-range input clamps: more than the total fills every segment, and a
 * negative, non-finite or zero total fills none — a meter cannot show a value it
 * was not given.
 */
export function segmentFills(value: number, total: number, count: number): number[] {
  const segments = Number.isInteger(count) && count > 0 ? Math.min(count, MAX_SEGMENTS) : 0;
  if (segments === 0) return [];
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return Array.from({ length: segments }, () => 0);
  }
  // Each segment clamps its own share below, so the whole needs no clamp here.
  const filled = (value / total) * segments;
  return Array.from({ length: segments }, (_, i) => Math.min(Math.max(filled - i, 0), 1));
}
