'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerDb } from '@/src/db/server';
import { logLine } from '@/src/llm/failure';
import { DEMO_ACCOUNT_EMAIL, DEMO_FIXTURE_PASSWORD, resetDemoData } from '@/src/db/demo-reset';

export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  const db = await createServerDb();
  const { error } = await db.auth.signInWithPassword({ email, password });

  if (error) {
    // WHY the message is passed through rather than replaced with something
    // generic: this build has published fixture credentials, so there is no
    // account enumeration to protect against, and "Invalid login credentials"
    // versus "database unreachable" is the difference between a five-second fix
    // and a confused demo.
    redirect(`/sign-in?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath('/', 'layout');
  redirect('/hub');
}

export async function signOut(): Promise<void> {
  const db = await createServerDb();
  await db.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/sign-in');
}

/**
 * Empties the demo account and drops you into it — ADR 0032 §4, as amended
 * twice.
 *
 * ONE PRESS. It signs in as the fixture, resets, and lands on `/welcome` —
 * which is the state the button exists to produce, so pressing it IS starting
 * the demo. No confirmation: the owner asked for one button, and what a typed
 * RESET guarded is one seeded account whose password is printed three lines
 * above it on the same page.
 *
 * WHY it lives on `/sign-in` rather than on a page inside the app. Both earlier
 * homes were behind a session and therefore behind a redirect. Hub's version
 * could not be reached by the only account that has it — `app/hub/page.tsx`
 * sends a user whose `onboarded_at` is null to `/welcome`, and this account's
 * `onboarded_at` is null by design. `/sign-in` is the one page with no such
 * decision in front of it.
 *
 * INVARIANT: this takes NO ACCOUNT from the caller. The address and the password
 *            are constants, and `reset_demo_account()` is `security definer`,
 *            takes no argument, and refuses any caller whose `raw_app_meta_data`
 *            is not marked — a column no signed-in user can write. So an
 *            unauthenticated POST here signs in as a published fixture and
 *            clears that fixture's own rows. It reaches nothing else, and it is
 *            no more than the printed password already allows.
 */
export async function resetDemoAccount(): Promise<void> {
  const db = await createServerDb();

  const { error } = await db.auth.signInWithPassword({
    email: DEMO_ACCOUNT_EMAIL,
    password: DEMO_FIXTURE_PASSWORD,
  });
  if (error) {
    // A code-owned sentence, unlike `signIn` above — there is no typed address
    // to correct here, so an upstream message would be noise the user cannot
    // act on. ADR 0028.
    console.error('demo reset sign-in failed', { code: error.code });
    redirect(`/sign-in?error=${encodeURIComponent('Could not sign in as the demo account.')}`);
  }

  try {
    await resetDemoData(db);
  } catch (cause) {
    // The name and a bounded message, never the object — ADR 0028.
    console.error('demo reset failed', logLine(cause));
    /*
     * SIGN OUT FIRST, and it is the difference between a rendered failure and a
     * silent one. FOUND IN REVIEW. The sign-in above has already succeeded by
     * this point, so the redirect lands on `/sign-in` holding a demo session —
     * and that page's first act is `if (user) redirect('/hub')`, which for this
     * account goes on to `/welcome`. The sentence could never be rendered: the
     * user pressed a destructive control, was carried into the app, and had no
     * way to learn that nothing had been deleted.
     *
     * A destructive control that fails silently reads as success, which is the
     * wrong direction for the only irreversible button in this project.
     */
    await db.auth.signOut();
    redirect(`/sign-in?error=${encodeURIComponent('The reset did not go through. Try again.')}`);
  }

  revalidatePath('/', 'layout');
  // Straight to the first question, which is the whole point of the control.
  redirect('/welcome');
}
