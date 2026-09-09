'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { isFutureBirthDate } from '@/src/diet/biometrics';
import { readSettingsForm, settingsSchema } from '@/src/settings/schema';
import type { SettingsFormState } from './form-state';

/**
 * The only place a `users` row is written by the application.
 *
 * INVARIANT: `user_id` comes from the verified session, never from a form
 *            field, and the RLS policy independently rejects an update to
 *            anyone else's row — CLAUDE.md #10.
 *
 * The schema and the form reader are in `src/settings/schema.ts` rather than
 * here: a `'use server'` module may export only async functions, so anything
 * declared in this file is unreachable from a test.
 */
export async function updateSettings(
  _previous: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const parsed = settingsSchema.safeParse(readSettingsForm(formData));

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issue ? `${issue.path.join('.') || 'form'}: ${issue.message}` : 'Could not save that.',
      saved: false,
    };
  }

  /*
   * "Not in the future" is neither a column CHECK nor a schema rule.
   *
   * INVARIANT: calendar questions are asked against the user's local date —
   *            CLAUDE.md #9. A CHECK holding `current_date` would evaluate in
   *            the SERVER's timezone, and the schema cannot know the timezone
   *            because the user may be changing it in this same submit. So it
   *            is checked here, against the zone that was just validated.
   */
  if (
    parsed.data.birthDate !== null &&
    isFutureBirthDate(parsed.data.birthDate, localDateFor(parsed.data.timezone))
  ) {
    return { error: 'birthDate: that date has not happened yet.', saved: false };
  }

  const { error } = await db
    .from('users')
    .update({
      display_name: parsed.data.displayName,
      timezone: parsed.data.timezone,
      humor_max_level: parsed.data.humorMaxLevel,
      theme: parsed.data.theme,
      leaderboard_opt_out: parsed.data.leaderboardOptOut,
      // Null is a real value here: clearing a field removes it, and the diet
      // block then names the one it is waiting for — ADR 0024 §6.
      bodyweight_kg: parsed.data.bodyweightKg,
      height_cm: parsed.data.heightCm,
      birth_date: parsed.data.birthDate,
      sex: parsed.data.sex,
    })
    .eq('user_id', user.id);

  if (error) {
    /*
     * The detail is kept, and not sent to the browser.
     *
     * WHY this changed when the biometrics landed — the same reasoning
     * app/coach/actions.ts already carries: this interpolated `error.message`,
     * and with CHECK-constrained columns that puts `new row for relation
     * "users" violates check constraint "users_bodyweight_kg_check"` on screen.
     * That hands a user table names, column semantics and constraint names for
     * a table they cannot read — harmless once, free reconnaissance in quantity.
     *
     * Every value that can fail a constraint has already been rejected above
     * with a sentence naming the field, so this branch is for the unexpected: a
     * dropped column, a revoked grant, a network fault.
     */
    console.error('settings save failed', error);
    return { error: 'Could not save that. Try again in a moment.', saved: false };
  }

  // Every surface reads the display name, the timezone decides what "today"
  // means on all of them (CLAUDE.md #9), and the theme is stamped by the layout
  // itself. Revalidate the layout, not one page.
  revalidatePath('/', 'layout');
  return { error: null, saved: true };
}
