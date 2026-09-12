'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerDb, currentUser } from '@/src/db/server';
import { DEMO_ACCOUNT_EMAIL, resetDemoData } from '@/src/db/demo-reset';
import { logLine } from '@/src/llm/failure';

/**
 * Returns the demo account to nothing — ADR 0032 §4.
 *
 * INVARIANT: the delete is scoped to the caller by RLS, and that — not the email
 *            check below — is what makes this safe. If the gate were bypassed
 *            entirely, the caller would delete their OWN training. The blast
 *            radius is the caller, always.
 *
 * INVARIANT: no service role, and every statement filtered to `user.id` from the
 *            verified session — CLAUDE.md #10.
 *
 * The email check decides who is OFFERED the button and who may call it. It is a
 * convenience gate on a demo control, and it is checked HERE as well as at the
 * render because a server action is an endpoint: rendering a button for one
 * account does not stop anyone else POSTing to it.
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
    await resetDemoData(db, user.id);
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
