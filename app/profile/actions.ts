'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerDb, currentUser } from '@/src/db/server';
import { HUMOR_LEVELS } from '@/src/persona/schema';
import { THEMES } from '@/src/ui/theme';
import type { ProfileFormState } from './form-state';

/**
 * The only place a `users` row is written by the application.
 *
 * INVARIANT: `user_id` comes from the verified session, never from a form
 *            field, and the RLS policy independently rejects an update to
 *            anyone else's row — CLAUDE.md #10.
 */

/**
 * A timezone the platform can actually resolve.
 *
 * WHY validated here rather than in the database: CLAUDE.md #9 makes every
 * calendar-triggered achievement evaluate against this string, and
 * `users.timezone` records that Postgres cannot check it — the IANA lookup is
 * not immutable. So the app boundary is the only place it can be checked, and
 * a bad value here silently moves someone's local date.
 */
function isKnownTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const settingsSchema = z.object({
  // Empty means "no name", not an empty name — the headers fall back to email.
  displayName: z
    .string()
    .trim()
    .max(60, 'Keep it to 60 characters.')
    .transform((value) => (value === '' ? null : value)),
  timezone: z
    .string()
    .trim()
    .refine(isKnownTimezone, 'That is not a timezone this device recognises.'),
  humorMaxLevel: z.enum(HUMOR_LEVELS),
  theme: z.enum(THEMES),
});

export async function updateSettings(
  _previous: ProfileFormState,
  formData: FormData
): Promise<ProfileFormState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const parsed = settingsSchema.safeParse({
    displayName: formData.get('displayName') ?? '',
    timezone: formData.get('timezone') ?? '',
    humorMaxLevel: formData.get('humorMaxLevel') ?? '',
    theme: formData.get('theme') ?? '',
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issue ? `${issue.path.join('.') || 'form'}: ${issue.message}` : 'Could not save that.',
      saved: false,
    };
  }

  const { error } = await db
    .from('users')
    .update({
      display_name: parsed.data.displayName,
      timezone: parsed.data.timezone,
      humor_max_level: parsed.data.humorMaxLevel,
      theme: parsed.data.theme,
    })
    .eq('user_id', user.id);

  if (error) return { error: `Could not save that: ${error.message}`, saved: false };

  // Every surface reads the display name, the timezone decides what "today"
  // means on all of them (CLAUDE.md #9), and the theme is stamped by the layout
  // itself. Revalidate the layout, not one page.
  revalidatePath('/', 'layout');
  return { error: null, saved: true };
}
