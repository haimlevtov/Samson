'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerDb, currentUser } from '@/src/db/server';
import { acceptChallenge } from '@/src/db/gamification';

/**
 * Accepting a challenge — the one write the Hub makes.
 *
 * INVARIANT: application code never uses the service role — CLAUDE.md #10. This
 *            runs on the request-scoped, RLS-bound client, and the RPC behind it
 *            filters on `auth.uid()` rather than on anything this form sends. A
 *            forged challenge id belonging to somebody else matches no row.
 *
 * WHY it takes only an id: accepting carries no numbers. The user is saying
 * which challenge is in play, not how far along it is — whether it was met is
 * still derived from logged rows by the weekly batch, so phase 4's "no
 * completion can be granted from the client" is untouched.
 *
 * AI-NOTE: do not add a status parameter here. The RPC decides what `offered`
 *          becomes; a caller that could name the target status could name
 *          `completed`.
 */
export async function acceptChallengeAction(formData: FormData): Promise<void> {
  const db = await createServerDb();

  /*
   * The session gate every other action in this app opens with, and this one
   * was missing. `anon` holds no EXECUTE on the RPC, so an unauthenticated post
   * was never a bypass — it was an uncaught PostgREST error escaping the action
   * instead of a redirect, which puts a Postgres message in the logs and on the
   * screen in development.
   */
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  /*
   * A malformed id is the same class as a missing one: nothing to do, and not
   * worth a crash. Without this, `challengeId=x` reaches Postgres and comes
   * back as `22P02 invalid input syntax for type uuid` — a 500 raised by a
   * value any authenticated user can type.
   */
  const parsed = z.uuid().safeParse(formData.get('challengeId'));
  if (!parsed.success) return;

  /*
   * A false return means the row was already accepted, is not this user's, or
   * its window has closed. None of those is an error worth interrupting for,
   * and the re-rendered page shows the challenge in whatever state it is
   * actually in — which is the honest answer, now that the RPC and the page
   * agree on what "expired" means. They did not before: the page used the
   * user's local date and the RPC used the server's, so a user west of UTC
   * could press a button that rendered and then silently refused.
   */
  await acceptChallenge(db, parsed.data);

  revalidatePath('/hub');
}
