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

export function SessionTimer({ startedAt }: { startedAt: string | null }) {
  // Rendered on the server too, so start from a value that cannot disagree
  // with the client's first paint and cause a hydration mismatch.
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!startedAt) return;
    const began = new Date(startedAt).getTime();
    if (Number.isNaN(began)) return;

    const tick = () => setElapsed(Math.floor((Date.now() - began) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <div className="card timer-card timer-session">
      <div className="timer-head">
        <div>
          <div className="label">Session</div>
          <div className="timer" aria-live="off">
            {elapsed === null ? '—:—' : format(elapsed)}
          </div>
        </div>
        <div className="muted small" style={{ textAlign: 'right' }}>
          {startedAt ? 'since you started' : 'not started'}
        </div>
      </div>
    </div>
  );
}
