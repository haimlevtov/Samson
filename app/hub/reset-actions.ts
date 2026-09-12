'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerDb, currentUser } from '@/src/db/server';
import { DEMO_ACCOUNT_EMAIL, resetDemoData } from '@/src/db/demo-reset';
import { logLine } from '@/src/llm/failure';

/**
 * Returns the demo account to nothing — ADR 0032 §4.
 *
 * INVARIANT: the work is `reset_demo_account()`, which TAKES NO ARGUMENT — the
 *            user is `auth.uid()` from the verified JWT, so a caller cannot
 *            express the wish to delete somebody else's rows.
 *
 * INVARIANT: that function is `security definer` and therefore runs OUTSIDE RLS,
 *            on purpose: four of the tables it clears are select-only by
 *            deliberate decision (ADR 0009), so a client delete against them
 *            matched no rows and succeeded silently. The email check is checked
 *            INSIDE the function, which is what makes it a control rather than
 *            the convenience an earlier version of this comment called it —
 *            ADR 0032 §4, "So the email check is a control now".
 *
 * The check below is the same gate, at the app layer, and it is here because a
 * server action is an endpoint: rendering a button for one account does not stop
 * anyone else POSTing to it. It is defence in depth, not the control.
 */
export async function resetDemoAccount(formData: FormData): Promise<void> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  if (user.email !== DEMO_ACCOUNT_EMAIL) {
    // Not an error the user needs explaining: they did not see this control, so
    // they did not press it. Nothing is deleted and nothing is said.
    redirect('/hub');
  }

  /*
   * The typed confirmation, matched exactly. A control that empties an account
   * on one tap is one somebody empties by accident — and this one is on the
   * first screen of the app, where an accidental press is likeliest.
   */
  if (String(formData.get('confirm') ?? '').trim() !== 'RESET') {
    redirect('/hub?reset=unconfirmed');
  }

  try {
    await resetDemoData(db);
  } catch (cause) {
    // Name and bounded message — ADR 0028. The row contents never reach the log:
    // this table is a health profile joined to an account id.
    console.error('demo reset failed', logLine(cause));
    redirect('/hub?reset=failed');
  }

  // Everything downstream of this reads the user's rows, and there are none now.
  revalidatePath('/', 'layout');
  // Straight back to the beginning, which is the whole point of the control.
  redirect('/welcome');
}
