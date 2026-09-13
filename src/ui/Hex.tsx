import type { CSSProperties, ReactNode } from 'react';
import type { Metal } from './tiers';

/**
 * The hexagonal emblem the Quest Log draws everything in — ADR 0033.
 *
 * `tone` is the ground; a `rim` wraps it in a band — a metal on the podium, or the
 * unlock sheet's violet `reveal` — 4px unless `band` says otherwise.
 *
 * WHY `clip-path` rather than an SVG: the emblem holds text and icons that are
 * ordinary DOM, so it inherits colour and font like anything else, and the shape
 * is one token (`--hex`) rather than a path per size.
 *
 * Decorative unless given a `label`. With one it is `role="img"` carrying that
 * name, so "Level 5" is what a screen reader hears rather than "L V L 5".
 */
export type HexTone = 'emblem' | 'soft' | 'plain' | 'warn' | 'good' | 'core' | Metal;

export function Hex({
  size,
  tone = 'emblem',
  rim,
  band = 4,
  label,
  className,
  children,
}: {
  size: number;
  tone?: HexTone;
  /** A metal band, or the unlock sheet's violet one. */
  rim?: Metal | 'reveal';
  /** The rim's width in px. The unlock sheet's is 7: a 98px badge in a 112px rim. */
  band?: number;
  label?: string;
  className?: string;
  children?: ReactNode;
}) {
  const a11y = label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label };

  if (rim === undefined) {
    return (
      <span
        className={`hex hex-${tone}${className ? ` ${className}` : ''}`}
        style={{ '--hex-size': `${size}px` } as CSSProperties}
        {...a11y}
      >
        {children}
      </span>
    );
  }

  return (
    <span
      className={`hex hex-rim hex-${rim}${className ? ` ${className}` : ''}`}
      style={{ '--hex-size': `${size}px` } as CSSProperties}
      {...a11y}
    >
      <span
        className={`hex hex-${tone}`}
        style={{ '--hex-size': `${size - band * 2}px` } as CSSProperties}
      >
        {children}
      </span>
    </span>
  );
}
