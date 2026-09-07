'use client';

import { useEffect } from 'react';

/**
 * The last resort, for a throw nothing else caught.
 *
 * WHY it exists — FOUND IN REVIEW, 2026-09-07: there was no error boundary
 * anywhere under `app/`, so any uncaught throw in a server component rendered
 * Next's built-in error page. That page has no retry, no navigation, and no way
 * back into the app — which is the "nothing happens" failure
 * `docs/specs/mobile-interface.md` §4 exists to forbid, arriving on the one
 * path nobody had rendered a state for.
 *
 * One file covers every throw site in the app, which is why it is here rather
 * than a try/catch added to each of them. Call sites still degrade locally
 * where degrading beats failing — `activeWorkout` in History and Workout are
 * both `.catch(() => null)`, because a missing session badge is better than a
 * missing page. This is for the throws that have no sensible local answer.
 *
 * AI-NOTE: `reset()` re-renders the segment without a full page load, so it
 *          retries the failed query rather than reloading the app. The tab bar
 *          is in the layout and survives, so there is always a way out even if
 *          the retry fails again.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is all the browser gets in production — the message is
    // stripped. Logging it here is what makes a report traceable to a server
    // log line.
    console.error('unhandled error', error.digest ?? error.message);
  }, [error]);

  return (
    <>
      <header className="top">
        <div>
          <h1>That did not load</h1>
          <span className="muted small">Something failed on the way to this screen.</span>
        </div>
      </header>

      <div className="card">
        <p className="muted">
          Nothing you logged is lost — this is a page that failed to draw, not a save that failed to
          happen. Try again, or use the tabs below.
        </p>

        <div className="row">
          <button type="button" onClick={reset}>
            Try again
          </button>
        </div>

        {error.digest === undefined ? null : (
          // Shown because it is the only handle a user can quote when asking
          // what went wrong, and it identifies the server log line.
          <p className="muted small">Reference: {error.digest}</p>
        )}
      </div>
    </>
  );
}
