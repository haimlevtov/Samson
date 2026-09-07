'use client';

import { useEffect, useState } from 'react';

/**
 * Elapsed session time.
 *
 * WHY it counts up from the stored `started_at` rather than from mount: the
 * server already recorded when the session began, so a refresh, a navigation
 * away, or a phone locking mid-workout must not reset it. The clock is a view
 * of a database value, not state the page owns.
 */
function format(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Rank 4 — interface spec §2. It lives in the session bar as a number and
 * nothing else: checkable at a glance, not competing with the grid.
 */
export function SessionTimer({
  startedAt,
  endedAt,
}: {
  startedAt: string | null;
  endedAt: string | null;
}) {
  // Rendered on the server too, so start from a value that cannot disagree
  // with the client's first paint and cause a hydration mismatch.
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!startedAt) return;
    const began = new Date(startedAt).getTime();
    if (Number.isNaN(began)) return;

    // A finished session lasted as long as it lasted. Counting to now would
    // put "121:20:46" on a workout that took an hour last week, and a number
    // the app has not computed is a number it must not show.
    const finished = endedAt === null ? null : new Date(endedAt).getTime();
    if (finished !== null && !Number.isNaN(finished)) {
      setElapsed(Math.floor((finished - began) / 1000));
      return;
    }

    const tick = () => setElapsed(Math.floor((Date.now() - began) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, endedAt]);

  return (
    <span className="session-clock" aria-live="off">
      {elapsed === null ? (startedAt ? '—:—' : 'not started') : format(elapsed)}
    </span>
  );
}
