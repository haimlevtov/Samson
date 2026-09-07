'use client';

import { signOut } from '../sign-in/actions';
import { clearAllDrafts } from '../history/[id]/session-draft';

/**
 * Sign out, and take the drafts with it.
 *
 * WHY this is a client component when the rest of /settings is not — FOUND IN
 * REVIEW, 2026-09-07: `signOut` clears the Supabase cookie, which is the only
 * thing that was ever cleared. Unfinished session drafts live in
 * `localStorage` under `samson:draft:<workoutId>` and survived it, so on a
 * shared or lab machine the next person could read the previous user's
 * weights, reps and exercise names straight out of devtools. RLS makes that
 * data unreachable through the app and does nothing at all about the disk.
 *
 * The sweep has to run in the browser, because that is where the storage is —
 * a server action cannot reach it. So the form keeps the server action and
 * gains an `onSubmit` that runs first.
 *
 * AI-NOTE: this does NOT preventDefault. The sweep is synchronous and the
 *          submission continues, so a failure to clear cannot strand somebody
 *          signed in — `clearAllDrafts` swallows its own errors for the same
 *          reason.
 */
export function SignOutButton() {
  return (
    <form action={signOut} onSubmit={() => clearAllDrafts()}>
      <button type="submit" className="secondary">
        Sign out
      </button>
    </form>
  );
}
