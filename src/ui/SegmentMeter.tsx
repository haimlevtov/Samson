import type { CSSProperties } from 'react';
import { segmentFills } from './segments';

/**
 * A meter drawn as countable segments — the Quest Log redesign.
 *
 * INVARIANT: `role="img"` with a sentence, because the segments are the one
 *            thing here a screen reader cannot count. The label says the same
 *            figures the text beside it does.
 */
export function SegmentMeter({
  value,
  total,
  count,
  label,
}: {
  value: number;
  total: number;
  count: number;
  label: string;
}) {
  const fills = segmentFills(value, total, count);
  return (
    <div
      className="seg-meter"
      role="img"
      aria-label={label}
      style={{ '--segments': fills.length } as CSSProperties}
    >
      {fills.map((fill, i) => (
        <span
          key={i}
          className={fill === 1 ? 'seg-full' : undefined}
          style={{ '--fill': `${Math.round(fill * 100)}%` } as CSSProperties}
        />
      ))}
    </div>
  );
}
