'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { isFutureBirthDate } from '@/src/diet/biometrics';
import { readSettingsForm, settingsSchema } from '@/src/settings/schema';
import { equipmentCatalogue, replaceEquipment } from '@/src/db/equipment';
import { equipmentSelection } from '@/src/settings/equipment';
import { forgetNote } from '@/src/db/notes';
import { logLine } from '@/src/llm/failure';
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
     * INVARIANT: no part of this error reaches the browser, and no part of the
     *            ROW reaches the log.
     *
     * Two leaks, in opposite directions, and fixing one opened the other.
     *
     * The browser half is the reasoning app/coach/actions.ts already carries:
     * this interpolated `error.message`, and with CHECK-constrained columns that
     * puts `new row for relation "users" violates check constraint
     * "users_bodyweight_kg_check"` on screen — table names, column semantics and
     * constraint names for a table the reader cannot query. Harmless once, free
     * reconnaissance in quantity.
     *
     * The log half is worse and was introduced by that fix — FOUND IN REVIEW.
     * Logging the PostgrestError whole looks prudent and is not: on a CHECK
     * violation PostgREST fills `details` from Postgres's errdetail, which is
     * `Failing row contains (…)` — EVERY column of the tuple. That is
     * `user_id`, `display_name`, `timezone`, `birth_date`, `sex`, `height_cm`
     * and `bodyweight_kg`: a complete health profile joined to an account
     * identifier, in plaintext, in the hosting runtime's logs. These are the
     * four fields ADR 0024 calls a more sensitive category than anything this
     * app stored before, and a log is a place nobody has thought about who can
     * read it.
     *
     * So: `code` and `hint` only. Both are PostgREST's own vocabulary and
     * neither can carry a submitted value.
     *
     * AI-NOTE: never log `error`, `error.message` or `error.details` for a write
     *          to `users`. If more diagnostic detail is ever needed, add named
     *          fields to this object rather than widening it to the whole error.
     */
    console.error('settings save failed', { code: error.code, hint: error.hint });
    return { error: 'Could not save that. Try again in a moment.', saved: false };
  }

  // Every surface reads the display name, the timezone decides what "today"
  // means on all of them (CLAUDE.md #9), and the theme is stamped by the layout
  // itself. Revalidate the layout, not one page.
  revalidatePath('/', 'layout');
  return { error: null, saved: true };
}

/**
 * The equipment picker — ADR 0029.
 *
 * INVARIANT: `user_id` comes from the verified session, never from a form field,
 *            and `user_equipment_own` independently rejects a write to anyone
 *            else's rows — CLAUDE.md #10. No service role.
 *
 * INVARIANT: the selection is filtered against the SHARED catalogue this request
 *            read, so a crafted slug reaches no insert — ADR 0029 §3. The
 *            planner's candidate join reads that catalogue, and a user-authored
 *            tag in it would be a user-authored input to invariant #5.
 *
 * The schema and the form reader are in `src/db/equipment.ts` rather than here,
 * for the reason `updateSettings` records: a `'use server'` module may export
 * only async functions, so anything declared in this file cannot be tested.
 */
export async function saveEquipment(
  _previous: SettingsFormState,
  formData: FormData
): Promise<SettingsFormState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  try {
    const tags = await equipmentCatalogue(db);
    const parsed = equipmentSelection(formData, tags);

    if (!parsed.success) {
      /*
       * The message comes from the schema, and it names WHICH item — FOUND IN
       * REVIEW. The hand-written sentence here stated a bound the server did not
       * enforce ("between 1 and 1000") and, with twelve possible ceiling fields,
       * told the user nothing about which row to fix.
       *
       * `issue.path` is `[index, 'maxLoadKg']`, and the index is into the
       * selection rather than into the catalogue — so the item is looked up
       * rather than guessed. Same shape `updateSettings` uses thirty lines up.
       */
      const issue = parsed.error.issues[0];
      const at = typeof issue?.path[0] === 'number' ? issue.path[0] : -1;
      const slug = at >= 0 ? formData.getAll('equipment')[at] : undefined;
      const named = tags.find((t) => t.slug === slug)?.name;

      return {
        error: named
          ? `${named}: ${issue?.message ?? 'that is not a weight.'}`
          : (issue?.message ?? 'Could not save that.'),
        saved: false,
      };
    }

    await replaceEquipment(db, user.id, parsed.data, tags);
  } catch (cause) {
    /*
     * ADR 0028: a code-owned sentence to the browser, and to the log a name plus
     * a BOUNDED message — which for this path does include up to 200 characters
     * of PostgREST's own words, because `replaceEquipment` wraps them. The ADR's
     * log clause permits that; an earlier version of this comment claimed the
     * opposite, which was the defect rather than the behaviour.
     *
     * AI-NOTE: never widen this to `error.details`. PostgREST puts the failing
     *          ROW there — `Failing row contains (…)` — and for this table that
     *          is the user's id. The 50-line-up AI-NOTE on the `users` write says
     *          the same thing about the same field.
     */
    console.error('equipment save failed', logLine(cause));
    return { error: 'Could not save that. Try again in a moment.', saved: false };
  }

  /*
   * Not `revalidatePath('/settings')`: what this changes is which exercises the
   * app will offer. The picker on `/workout/new` is filtered by it, and `/coach`
   * refuses a plan without it (ADR 0027 §5), so both are stale the moment this
   * returns. Revalidating the layout is the same call `updateSettings` makes for
   * the same reason.
   */
  revalidatePath('/', 'layout');
  return { error: null, saved: true };
}

/**
 * Removes one thing the coach remembers — ADR 0030 §4.
 *
 * INVARIANT: `user_id` comes from the verified session, and `coach_notes_own`
 *            independently rejects a delete of anyone else's row — CLAUDE.md
 *            #10. The id from the form is a filter, never an authorisation.
 *
 * WHY it returns void rather than a form state: this is a bare `<form action>`
 * on a server component, which is what keeps /settings free of client state. A
 * note that fails to delete is logged by name and bounded message (ADR 0028);
 * the page re-renders either way and the note is either gone or still listed,
 * which is the honest report of what happened.
 */
export async function forgetCoachNote(formData: FormData): Promise<void> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const id = String(formData.get('noteId') ?? '');
  if (id === '') return;

  try {
    await forgetNote(db, user.id, id);
  } catch (cause) {
    console.error('coach note not deleted', logLine(cause));
  }

  // The coach reads these on the next message, and Settings lists them.
  revalidatePath('/settings');
  revalidatePath('/coach');
}
