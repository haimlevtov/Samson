'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { logLine } from '@/src/llm/failure';
import { DIET_GOALS } from '@/src/diet/energy';
import { isFutureBirthDate } from '@/src/diet/biometrics';
import {
  INCOMPLETE_BODY_MESSAGE,
  PARTIAL_BIRTH_DATE_MESSAGE,
  composeBirthDate,
  isCompleteBody,
  onboardingBodySchema,
  readBirthDateParts,
  readBodyForm,
} from '@/src/onboarding/schema';
import { listPersonas } from '@/src/db/personas';
import { ONBOARDING_STEPS, type OnboardingStep } from '@/src/onboarding/steps';
import { INVALID_MESSAGE, SAVE_FAILED_MESSAGE, type WelcomeState } from './welcome-state';

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
export async function saveName(_previous: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const typed = String(formData.get('displayName') ?? '');
  const parsed = z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(60))
    .safeParse(typed);

  // The form KEEPS WHAT WAS TYPED — mobile-interface.md §4. This used to
  // redirect, which threw it away.
  if (!parsed.success) return { error: INVALID_MESSAGE, values: { displayName: typed } };

  const { error } = await db
    .from('users')
    .upsert({ user_id: user.id, display_name: parsed.data }, { onConflict: 'user_id' });

  if (error) {
    // Code, hint and nothing else — the reasoning `updateSettings` carries: a
    // CHECK violation puts the whole failing row in `details`, and for this
    // table that is a health profile joined to an account id.
    console.error('onboarding name failed', { code: error.code, hint: error.hint });
    // A DIFFERENT sentence — ADR 0028. "Have another go" tells somebody with
    // valid input to retype it forever.
    return { error: SAVE_FAILED_MESSAGE, values: { displayName: typed } };
  }

  revalidatePath('/', 'layout');
  redirect(nextUrl(formData));
}

/**
 * Step 3 — the four the diet engine needs, validated by the schema that already
 * owns their bounds (ADR 0024). Not re-stated here: two definitions of "a
 * plausible height" is how they come to disagree.
 */
export async function saveBiometrics(
  _previous: WelcomeState,
  formData: FormData
): Promise<WelcomeState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  /*
   * Echoed back on every refusal — mobile-interface.md §4. Four fields is where
   * this rule earns its keep: one out-of-range height used to cost the user
   * their weight, height, date of birth and sex.
   */
  const parts = readBirthDateParts(formData);
  const typed: Record<string, string> = {
    bodyweightKg: String(formData.get('bodyweightKg') ?? ''),
    heightCm: String(formData.get('heightCm') ?? ''),
    // The three selects echo back separately — rework PR 9. Echoing the composed
    // ISO date would put nothing back in the controls the user actually used.
    birthDay: parts.day,
    birthMonth: parts.month,
    birthYear: parts.year,
    sex: String(formData.get('sex') ?? ''),
  };

  /*
   * A date that is two thirds answered, which a single input could not produce.
   * Its own sentence rather than the four-or-none one: "fill in the rest" is
   * true of the whole step, and this is about one control. Treating it as blank
   * would silently discard two answers the user gave.
   */
  if (composeBirthDate(parts).partial) {
    return { error: PARTIAL_BIRTH_DATE_MESSAGE, values: typed };
  }

  const parsed = onboardingBodySchema.safeParse(readBodyForm(formData));
  if (!parsed.success) return { error: INVALID_MESSAGE, values: typed };

  /*
   * ALL FOUR, or the Skip button. The rule and its reasoning live in
   * `src/onboarding/schema.ts` — nothing under `app/` is in the unit suite, so a
   * guard written here is one no test can hold. A DIFFERENT sentence from the
   * bounds refusal above, per ADR 0028: "that did not look right" is the wrong
   * thing to tell somebody whose three answers were all fine.
   */
  const body = parsed.data;
  if (!isCompleteBody(body)) return { error: INCOMPLETE_BODY_MESSAGE, values: typed };

  // INVARIANT: calendar questions use the user's local date — CLAUDE.md #9.
  // The null check this used to carry is `isCompleteBody`'s job — it is a type
  // predicate, so the narrowing is the compiler's rather than a second check.
  if (isFutureBirthDate(body.birthDate, localDateFor(user.timezone))) {
    return { error: 'That date has not happened yet.', values: typed };
  }

  const { error } = await db.from('users').upsert(
    {
      user_id: user.id,
      bodyweight_kg: body.bodyweightKg,
      height_cm: body.heightCm,
      birth_date: body.birthDate,
      sex: body.sex,
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    console.error('onboarding biometrics failed', { code: error.code, hint: error.hint });
    return { error: SAVE_FAILED_MESSAGE, values: typed };
  }

  revalidatePath('/', 'layout');
  redirect(nextUrl(formData));
}

/**
 * Step 4 — the diet goal, which now has a column to live in (ADR 0032 §3).
 *
 * `.catch` rather than a rejection, matching `askTheCoach`: an unrecognised goal
 * is not worth a message, and maintain is the safe direction.
 */
export async function saveGoal(_previous: WelcomeState, formData: FormData): Promise<WelcomeState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  /*
   * safeParse, NOT `.catch('maintain')` — FOUND IN REVIEW. Swallowing an
   * unrecognised value writes a goal the user did not choose, and destroys for
   * them the has-not-said/said-maintain distinction this column exists for
   * (ADR 0032 §3). The Coach tab's own selector may fall back, because there the
   * value is carried with the request and nothing is stored.
   */
  const parsed = z.enum(DIET_GOALS).safeParse(formData.get('goal'));
  if (!parsed.success) return { error: INVALID_MESSAGE, values: {} };
  const goal = parsed.data;

  const { error } = await db
    .from('users')
    .upsert({ user_id: user.id, diet_goal: goal }, { onConflict: 'user_id' });

  if (error) {
    console.error('onboarding goal failed', { code: error.code, hint: error.hint });
    return { error: SAVE_FAILED_MESSAGE, values: {} };
  }

  revalidatePath('/', 'layout');
  redirect(nextUrl(formData));
}

/**
 * Step 2 — which coach, stored in `users.persona_slug` (rework PR 8).
 *
 * INVARIANT: the slug is checked against the rows `listPersonas` returns, not
 *            against a list in code. Personas are rows (CLAUDE.md #7), the
 *            column carries no foreign key — the migration argues why — and this
 *            read is the integrity that replaces one. `personas_read` scopes it
 *            to the shared coaches plus the user's own, so a slug belonging to
 *            somebody else's persona is not in the list and is refused.
 *
 * It also excludes inactive coaches, which an FK could not have: a retired coach
 * is `is_active = false` rather than a deleted row.
 */
export async function saveCoach(
  _previous: WelcomeState,
  formData: FormData
): Promise<WelcomeState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const chosen = String(formData.get('personaSlug') ?? '');

  /*
   * A read before a write, and worth its round trip: the alternative is trusting
   * a posted string into a column every voice and delivery path then reads.
   * `listPersonas` throws rather than returning empty on a failure, so a broken
   * read cannot quietly become "no coach matched".
   */
  /*
   * Echoed back on every refusal — mobile-interface.md §4, and the INVARIANT
   * `welcome-state.ts` states. FOUND IN REVIEW: this returned `values: {}` and
   * the radios carried no `defaultChecked`, so a transient failure cleared the
   * pick and left six bios and six lines to read again. The other three steps in
   * this file have echoed since they shipped; this one did not.
   */
  const typed = { personaSlug: chosen };

  let offered: string[];
  try {
    offered = (await listPersonas(db)).map((persona) => persona.slug);
  } catch (cause) {
    console.error('onboarding coach list failed', logLine(cause));
    return { error: SAVE_FAILED_MESSAGE, values: typed };
  }

  if (!offered.includes(chosen)) return { error: INVALID_MESSAGE, values: typed };

  const { error } = await db
    .from('users')
    .upsert({ user_id: user.id, persona_slug: chosen }, { onConflict: 'user_id' });

  if (error) {
    console.error('onboarding coach failed', { code: error.code, hint: error.hint });
    return { error: SAVE_FAILED_MESSAGE, values: typed };
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
  // A server action is an endpoint. Nothing here is exploitable — the path is a
  // literal and the value is encoded — but an unauthenticated POST should not
  // turn into a multi-kilobyte redirect, and the allowlist costs one line.
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const raw = String(formData.get('step') ?? '');
  if (!(ONBOARDING_STEPS as readonly string[]).includes(raw)) redirect('/welcome');
  const step = raw as OnboardingStep;
  const already = String(formData.get('skipped') ?? '')
    .split(',')
    .filter((value) => value !== '');

  const next = [...new Set([...already, step])].join(',');
  redirect(`/welcome?skip=${encodeURIComponent(next)}`);
}

/**
 * Leaves onboarding for the app, whatever is left unanswered.
 *
 * Stamps `onboarded_at` — the one thing this flow stores that is not derivable
 * (ADR 0032 §2 as amended). Without it, Hub cannot tell a new user from somebody
 * who cleared their display name, and used to send the second one back here
 * forever.
 */
export async function finishOnboarding(): Promise<void> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const { error } = await db
    .from('users')
    .upsert(
      { user_id: user.id, onboarded_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );

  /*
   * FOUND IN REVIEW, and the comment that was here was the bug. It said "not
   * worth stopping for: the worst case is the welcome flow asking again, which
   * is where they already are and which costs them one press".
   *
   * The worst case is an INFINITE REDIRECT. `/welcome` calls this function
   * during render when every question is answered, so: stamp fails → `/hub` →
   * `onboardedAt` is null → `/welcome` → nothing left to ask → stamp fails →
   * `/hub` → … Both are server redirects, so the browser follows until it gives
   * up with ERR_TOO_MANY_REDIRECTS: a blank page, no message, no way back, for
   * a user whose data is perfectly intact.
   *
   * So the failure gets a rendered owner. `/welcome` reads this flag BEFORE it
   * decides there is nothing left to ask, which is what stops the loop
   * re-entering the same call.
   */
  if (error) {
    console.error('onboarding stamp failed', { code: error.code, hint: error.hint });
    redirect('/welcome?finish=failed');
  }

  /*
   * NO `revalidatePath` — FOUND IN REVIEW, and it was a runtime error rather
   * than a tidiness point. The welcome page awaits this function during RENDER
   * on the everything-already-answered path, and Next refuses a revalidate
   * there. It is not needed either: /hub is `force-dynamic`, so the redirect
   * re-reads the row this just wrote.
   */
  redirect('/hub');
}
