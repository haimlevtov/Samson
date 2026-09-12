'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { DIET_GOALS } from '@/src/diet/energy';
import { isFutureBirthDate } from '@/src/diet/biometrics';
import { onboardingBodySchema, readBodyForm } from '@/src/onboarding/schema';
import type { OnboardingStep } from '@/src/onboarding/steps';

/**
 * Onboarding's writes — ADR 0032 §2.
 *
 * INVARIANT: every one is an UPSERT, not an update. `public.users` has no row
 *            for a user who has never been seeded, and an UPDATE matching no
 *            rows is a silent success — so an update here would report that the
 *            name was saved and save nothing. That is ADR 0032 §1's finding, and
 *            it is a live bug for any real sign-up rather than a quirk of this
 *            feature.
 *
 * INVARIANT: `user_id` comes from the verified session and `users_insert_own` /
 *            `users_update_own` both check it against `auth.uid()` — CLAUDE.md
 *            #10. No service role.
 *
 * Each step writes and then redirects to `/welcome`, which re-derives where the
 * user is up to from what is now stored. There is no cursor to keep in step with
 * the data, which is what makes a closed tab cost nothing.
 */

/** Carries the skip list through a redirect, so a skip survives the round trip. */
function nextUrl(formData: FormData): string {
  const skipped = String(formData.get('skipped') ?? '').trim();
  return skipped === '' ? '/welcome' : `/welcome?skip=${encodeURIComponent(skipped)}`;
}

/**
 * Step 1 — the name, and the only answer onboarding insists on.
 *
 * Bounded at 60 the way `settingsSchema` bounds it, and trimmed: a name of
 * spaces would satisfy `min(1)` and leave `nextStep` asking again forever, which
 * is a loop rather than a validation message.
 */
export async function saveName(formData: FormData): Promise<void> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const parsed = z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(60))
    .safeParse(formData.get('displayName'));

  // Back to the same question rather than an error page: the step renders its
  // own "that did not look like a name" from the query flag.
  if (!parsed.success) redirect('/welcome?invalid=name');

  const { error } = await db
    .from('users')
    .upsert({ user_id: user.id, display_name: parsed.data }, { onConflict: 'user_id' });

  if (error) {
    // Code, hint and nothing else — the reasoning `updateSettings` carries: a
    // CHECK violation puts the whole failing row in `details`, and for this
    // table that is a health profile joined to an account id.
    console.error('onboarding name failed', { code: error.code, hint: error.hint });
    redirect('/welcome?invalid=name');
  }

  revalidatePath('/', 'layout');
  redirect(nextUrl(formData));
}

/**
 * Step 2 — the four the diet engine needs, validated by the schema that already
 * owns their bounds (ADR 0024). Not re-stated here: two definitions of "a
 * plausible height" is how they come to disagree.
 */
export async function saveBiometrics(formData: FormData): Promise<void> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const parsed = onboardingBodySchema.safeParse(readBodyForm(formData));
  if (!parsed.success) redirect('/welcome?invalid=body');

  // INVARIANT: calendar questions use the user's local date — CLAUDE.md #9.
  if (
    parsed.data.birthDate !== null &&
    isFutureBirthDate(parsed.data.birthDate, localDateFor(user.timezone))
  ) {
    redirect('/welcome?invalid=body');
  }

  const { error } = await db.from('users').upsert(
    {
      user_id: user.id,
      bodyweight_kg: parsed.data.bodyweightKg,
      height_cm: parsed.data.heightCm,
      birth_date: parsed.data.birthDate,
      sex: parsed.data.sex,
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    console.error('onboarding biometrics failed', { code: error.code, hint: error.hint });
    redirect('/welcome?invalid=body');
  }

  revalidatePath('/', 'layout');
  redirect(nextUrl(formData));
}

/**
 * Step 3 — the diet goal, which now has a column to live in (ADR 0032 §3).
 *
 * `.catch` rather than a rejection, matching `askTheCoach`: an unrecognised goal
 * is not worth a message, and maintain is the safe direction.
 */
export async function saveGoal(formData: FormData): Promise<void> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const goal = z.enum(DIET_GOALS).catch('maintain').parse(formData.get('goal'));

  const { error } = await db
    .from('users')
    .upsert({ user_id: user.id, diet_goal: goal }, { onConflict: 'user_id' });

  if (error) {
    console.error('onboarding goal failed', { code: error.code, hint: error.hint });
    redirect('/welcome?invalid=goal');
  }

  revalidatePath('/', 'layout');
  redirect(nextUrl(formData));
}

/**
 * Passes over a step without answering it — ADR 0032 §2.
 *
 * The skip list lives in the URL rather than in a table: a skip is a statement
 * about this sitting, not about the user, and somebody who comes back tomorrow
 * should be asked again rather than carried past a question they never answered.
 */
export async function skipStep(formData: FormData): Promise<void> {
  const step = String(formData.get('step') ?? '') as OnboardingStep;
  const already = String(formData.get('skipped') ?? '')
    .split(',')
    .filter((value) => value !== '');

  const next = [...new Set([...already, step])].join(',');
  redirect(`/welcome?skip=${encodeURIComponent(next)}`);
}

/** Leaves onboarding for the app, whatever is left unanswered. */
export async function finishOnboarding(): Promise<void> {
  redirect('/hub');
}
