'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

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

  return (
    <span className="hint" ref={wrapRef}>
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
      <span className="hint-bubble" role="tooltip" data-open={open || undefined}>
        <strong>{title}</strong>
        {children}
      </span>
    </span>
  );
}
