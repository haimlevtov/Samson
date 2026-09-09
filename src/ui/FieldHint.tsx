'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Breathing room kept between the bubble and either edge of the viewport. */
const EDGE_GUTTER = 8;

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
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  /*
   * Pull the bubble back inside the viewport — ADR 0022.
   *
   * WHY this is not a CSS problem: the bubble is absolutely positioned against
   * its own `.hint`, so `max-width` constrains how WIDE it is and says nothing
   * about where its right edge lands. At 375px the max-width resolves to 260px,
   * so any hint whose button sits past x=115 hangs off the edge and the page
   * scrolls sideways — which docs/specs/mobile-interface.md forbids outright.
   * MEASURED before the fix, /profile at 375px: scrollWidth 375 with the hints
   * closed, 418 with the right-hand tile's hint open.
   *
   * The shift is written as a custom property rather than as `left`, so the
   * ≥560px rule can keep centring with `transform: translateX(-50%)` and this
   * composes with it instead of fighting it.
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
    // rather than the last one this function chose.
    bubble.style.setProperty('--hint-shift', '0px');
    const rect = bubble.getBoundingClientRect();
    // Zero width means it is still display:none — nothing to place yet.
    if (rect.width === 0) return;

    const viewport = document.documentElement.clientWidth;
    // Negative when the right edge overhangs; never positive, so a bubble that
    // already fits is left exactly where the stylesheet put it.
    let shift = Math.min(0, viewport - EDGE_GUTTER - rect.right);
    // And never so far that the left edge leaves the screen. The bubble is
    // narrower than the viewport at every width this ships to, so both
    // constraints are satisfiable and the left one wins.
    if (rect.left + shift < EDGE_GUTTER) shift = EDGE_GUTTER - rect.left;

    bubble.style.setProperty('--hint-shift', `${Math.round(shift)}px`);
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
   * The tapped-open path, plus rotating the phone with one open.
   *
   * The resize listener is attached only while this hint is open, so the forty
   * others on the page cost nothing — /profile alone renders eleven.
   */
  useMeasureEffect(() => {
    if (!open) return;
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [open, clamp]);

  return (
    <span
      className="hint"
      ref={wrapRef}
      // The two paths CSS opens without telling React: `:hover` for a pointer
      // and `:focus-within` for a keyboard. Both have already applied by the
      // time these fire, so the bubble is laid out and measurable.
      onPointerEnter={clamp}
      onFocus={clamp}
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
