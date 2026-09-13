'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Hex } from '@/src/ui/Hex';
import { Icon } from '@/src/ui/icons';
import { nextFocusIndex, withoutUnlocked, type UnlockSheetProps } from '@/src/ui/unlock';

/**
 * The badge unlock as a sheet over History — the Quest Log redesign.
 *
 * Everything it shows was decided on the server by `unlockSheetProps`. This
 * component owns one thing: being dismissed, once.
 *
 * WHY a dialog, when the handoff drew `role="status"`: it covers the page and
 * takes the backdrop's clicks, so it behaves as a modal whatever its role says.
 * So it is `role="dialog"` and `aria-modal`, labelled by what happened AND by the
 * badge ("Achievement unlocked, The Long Way Up"), focus moves to Continue on
 * open and stays inside, and Escape, the backdrop and Continue close it.
 *
 * WHY it is open only while the ROUTER's search params name this badge — FOUND IN
 * REVIEW. Closing drops `?unlocked=` from the address, but Next keeps the page as
 * it was rendered, and Back restored that copy with the sheet in it: dismissed on
 * Continue, back again on the way back from the session. Reading the params the
 * router holds, and passing `null` state to `replaceState` so the router SEES the
 * change (Next's own state object makes it skip the sync), closes it for good.
 *
 * WHY Continue is a link: the sheet is rendered open on the server. If this
 * component's JavaScript never arrives, a button would do nothing and the backdrop
 * would block History; a link to `/history` — without the parameter — still gets
 * somebody out.
 */
export function UnlockSheet({
  slug,
  name,
  description,
  sourceHint,
  hidden,
  metal,
  icon,
}: UnlockSheetProps) {
  const params = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  const open = params.get('unlocked') === slug && !dismissed;

  const continueRef = useRef<HTMLAnchorElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const pressedBackdrop = useRef(false);

  const dropParam = useCallback(() => {
    window.history.replaceState(null, '', withoutUnlocked(window.location.href));
  }, []);

  const close = useCallback(() => {
    setDismissed(true);
    dropParam();
    /*
     * Focus goes to the page's heading, not <body>: the sheet opened on load, so
     * there was no control to return to, and a keyboard user would otherwise
     * start again from the top of the document.
     */
    const heading = document.querySelector<HTMLElement>('header.top h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus();
    }
  }, [dropParam]);

  useEffect(() => {
    if (!open) return;
    continueRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        // aria-modal tells a screen reader the page behind is inert; it does not
        // stop the browser's focus order walking into links behind the backdrop.
        const controls = [...(sheetRef.current?.querySelectorAll<HTMLElement>('a[href]') ?? [])];
        const next = nextFocusIndex(
          controls.indexOf(document.activeElement as HTMLElement),
          controls.length,
          event.shiftKey
        );
        if (next < 0) return;
        event.preventDefault();
        controls[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="unlock-backdrop"
      /*
       * Closes only when the press STARTED and ended on the backdrop — a text
       * selection dragged out of the card ends on the backdrop too, and must not
       * throw the sheet away.
       */
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) close();
      }}
    >
      <div
        className="unlock-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlock-kicker unlock-name"
        aria-describedby="unlock-description"
      >
        <Hex size={112} band={7} rim="reveal" tone={metal}>
          <Icon name={icon} size={44} />
        </Hex>
        {/*
         * The kicker changes because the reveal IS the reward for the hidden
         * tier: there was no announcement, no progress bar and no name in the
         * list beforehand, so "you found something" is the whole difference
         * between this badge and every other one.
         */}
        <p id="unlock-kicker" className="unlock-kicker">
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
              coach-memory PR 7, not Profile, which the handoff predates. It drops
              the parameter first, so Back from /badges does not fire it again. */}
          <Link href={`/badges#${slug}`} className="unlock-secondary" onClick={dropParam}>
            All badges
          </Link>
          <Link
            href="/history"
            ref={continueRef}
            className="unlock-continue"
            onClick={(event) => {
              event.preventDefault();
              close();
            }}
          >
            Continue
          </Link>
        </div>
      </div>
    </div>
  );
}
