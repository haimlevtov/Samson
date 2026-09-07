'use server';

import { revalidatePath } from 'next/cache';
import { createServerDb } from '@/src/db/server';
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
  const challengeId = String(formData.get('challengeId') ?? '');
  if (challengeId === '') return;

  const db = await createServerDb();

  /*
   * A false return is not an error worth showing. It means the row was already
   * accepted, is not this user's, or its window has closed — and in every one of
   * those cases the re-rendered page is the honest answer, because it shows the
   * challenge in whatever state it is actually in.
   */
  await acceptChallenge(db, challengeId);

  revalidatePath('/hub');
}
