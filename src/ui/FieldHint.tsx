'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { computeHintShift } from './hint-position';

/**
 * WHY a layout effect and not a plain one: `useEffect` runs AFTER paint, so the
 * bubble would be drawn once at the position that overflows and then jump —
 * one frame of the exact sideways scroll this is here to remove. The layout
 * effect measures and shifts before anything is painted.
 *
 * The `typeof window` switch is only to keep React quiet during server render,
 * where there is nothing to measure; it is the standard shape for this.
 */
const useMeasureEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * A small "?" next to a field label that explains it.
 *
 * WHY it responds to both hover and click: hover does not exist on a phone, and
 * this app is used in a gym. The button is a real focusable control rather than
 * a styled span so it also opens from the keyboard.
 *
 * Used on the dashboard stat tiles and on set entry. Phase 4 should reuse it for
 * XP and streak rules rather than writing a second one.
 */
export function FieldHint({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  /*
   * Revealed by hover or by focus, which CSS does without telling React.
   *
   * FOUND IN REVIEW: gating the re-measure on `open` alone left reachable states
   * where the bubble is on screen and nothing owns it. Tab to the `?` and press
   * Escape: `open` goes false, but Escape does not blur, so `:focus-within`
   * keeps it displayed — visible, with a shift that a resize would never
   * update. A shift measured at 900px still applied at 375px puts the left edge
   * off screen, which is worse than the overflow this fixes.
   */
  const [revealed, setRevealed] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  /*
   * Pull the bubble back inside the viewport — ADR 0022. The arithmetic is in
   * `computeHintShift`, which is pure and unit-tested; this half is only the
   * measuring, because that is the half that needs a DOM.
   *
   * WHY it is not a CSS problem: the bubble is absolutely positioned against its
   * own `.hint`, so `max-width` constrains how WIDE it is and says nothing about
   * where its right edge lands. At 375px the max-width resolves to 260px, so a
   * hint whose button has been pushed right — by a long label, most of all —
   * hangs off the edge and the page scrolls sideways. MEASURED before the fix,
   * /profile at 375px: scrollWidth 375 with the hints closed, 418 with the
   * "Adherence · 4 wks" hint open.
   *
   * The shift is written as a custom property rather than as `left`, so the
   * min-width: 760px rule can keep centring with `transform: translateX(-50%)`
   * and this composes with it instead of fighting it.
   *
   * AI-NOTE: this runs on every path that can REVEAL the bubble, because CSS
   *          owns visibility and JS owns position. A new way to show one — a
   *          new pseudo-class, a new state — needs a call here too, or that
   *          path silently goes back to overflowing.
   */
  const clamp = useCallback(() => {
    const bubble = bubbleRef.current;
    if (!bubble) return;

    // Measured with no shift applied, so the reading is the natural position
    // rather than the last one this function chose. Setting the property
    // dirties style and `getBoundingClientRect` flushes layout, so the read
    // below is of the natural position and not of a stale frame.
    bubble.style.setProperty('--hint-shift', '0px');
    const rect = bubble.getBoundingClientRect();
    // Zero width means it is still display:none — nothing to place yet, and
    // nothing has been lost, because a reveal always ends in a clamp.
    if (rect.width === 0) return;

    const shift = computeHintShift(rect, document.documentElement.clientWidth);
    bubble.style.setProperty('--hint-shift', `${shift}px`);
  }, []);

  // A tap outside closes it. Without this the bubble sticks open on a phone,
  // where there is no pointer to move away.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /*
   * Re-measure whenever this bubble is on screen, by any of the three routes,
   * and keep it correct while it stays there.
   *
   * The listener is attached per VISIBLE hint rather than per rendered one, so
   * the fifteen other call sites in the app cost nothing — and no page renders
   * more than the eight on /profile. A module-level listener that clamped every
   * instance would be worse: N alternating writes and reads, each forcing a
   * reflow, on every resize tick.
   */
  const visible = open || revealed;
  useMeasureEffect(() => {
    if (!visible) return;
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [visible, clamp]);

  return (
    <span
      className="hint"
      ref={wrapRef}
      /*
       * The two routes CSS opens without telling React. `onFocus` and `onBlur`
       * are React's `focusin`/`focusout`, which bubble, so focus landing on the
       * button reaches this wrapper — `:focus-within` has already applied by
       * then, so the bubble is laid out and measurable.
       */
      onPointerEnter={() => setRevealed(true)}
      onPointerLeave={() => setRevealed(false)}
      onFocus={() => setRevealed(true)}
      onBlur={() => setRevealed(false)}
    >
      <button
        // INVARIANT of forms, not of this project: without type="button" this
        // submits the set-entry form it sits inside.
        type="button"
        className="hint-btn"
        aria-label={`What does ${title} mean?`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      <span className="hint-bubble" role="tooltip" ref={bubbleRef} data-open={open || undefined}>
        <strong>{title}</strong>
        {children}
      </span>
    </span>
  );
}
