'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Hex } from '@/src/ui/Hex';
import { Icon, type IconName } from '@/src/ui/icons';
import type { Metal } from '@/src/ui/tiers';

/**
 * The badge unlock as a sheet over History — the Quest Log redesign.
 *
 * Everything it shows was decided on the server by `BadgeReveal`, which renders
 * this only for a badge the caller holds. This component owns one thing: being
 * dismissed.
 *
 * WHY a dialog, when the handoff drew `role="status"`: it covers the page and
 * takes the backdrop's clicks, so it behaves as a modal whatever its role says.
 * A status region over a blocked page leaves a keyboard user tabbing through
 * links they cannot see. So it is `role="dialog"` and `aria-modal`, focus moves
 * to Continue when it opens — which is also what announces it — and Escape, the
 * backdrop and Continue close it.
 *
 * WHY closing also drops `?unlocked=` from the address: a reload would otherwise
 * show the same badge again, as a new event it is not. `replaceState` changes
 * the URL without a request, so nothing reloads.
 */
export function UnlockSheet({
  slug,
  name,
  description,
  sourceHint,
  hidden,
  metal,
  icon,
}: {
  slug: string;
  name: string;
  description: string;
  sourceHint: string | null;
  hidden: boolean;
  metal: Metal;
  icon: IconName;
}) {
  const [open, setOpen] = useState(true);
  const continueRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('unlocked');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  };

  useEffect(() => {
    if (!open) return;
    continueRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      /*
       * Keep Tab inside the sheet. `aria-modal` tells a screen reader the page
       * behind is inert; it does not stop the browser's own focus order walking
       * into links nobody can see behind the backdrop.
       */
      if (event.key === 'Tab') {
        const controls = [
          ...(sheetRef.current?.querySelectorAll<HTMLElement>('a[href], button') ?? []),
        ];
        if (controls.length === 0) return;
        const at = controls.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? at <= 0
            ? controls.length - 1
            : at - 1
          : at === -1 || at === controls.length - 1
            ? 0
            : at + 1;
        event.preventDefault();
        controls[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="unlock-backdrop"
      // The backdrop, not the sheet: a click inside the card must not close it.
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="unlock-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlock-name"
        aria-describedby="unlock-description"
      >
        <Hex size={112} rim="reveal" tone={metal}>
          <Icon name={icon} size={44} />
        </Hex>
        {/*
         * The kicker changes because the reveal IS the reward for the hidden
         * tier: there was no announcement, no progress bar and no name in the
         * list beforehand, so "you found something" is the whole difference
         * between this badge and every other one.
         */}
        <p className="unlock-kicker">
          {hidden ? 'Something hidden, found' : 'Achievement unlocked'}
        </p>
        <h2 id="unlock-name" className="display">
          {name}
        </h2>
        <p id="unlock-description" className="unlock-description">
          {description}
        </p>
        {sourceHint !== null ? <p className="unlock-hint">{sourceHint}</p> : null}
        {hidden ? (
          <p className="unlock-chips">
            <span className="unlock-chip">hidden</span>
            <span className="unlock-chip unlock-chip-found">found</span>
          </p>
        ) : null}
        <div className="unlock-actions">
          {/* To its own card in the catalogue — where badges have lived since
              coach-memory PR 7, not Profile, which the handoff predates. */}
          <Link href={`/badges#${slug}`} className="unlock-secondary">
            All badges
          </Link>
          <button type="button" ref={continueRef} onClick={close}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
