'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { createTemplate, deleteTemplate, exerciseIdsBySlug } from '@/src/db/templates';
import { latestAcceptedPlan } from '@/src/db/personas';
import { loadWorkout } from '@/src/db/training';
import { templateDraftSchema } from '@/src/templates/schema';
import { templateFromSession } from '@/src/templates/derive';
import { templateFromPlannedSession } from '@/src/templates/plan';
import type { TemplateFormState } from './form-state';

/**
 * Every write here runs on the request-scoped, RLS-bound client.
 *
 * INVARIANT: application code never uses the service role — CLAUDE.md #10, and
 *            `user_id` always comes from the verified session rather than a
 *            form field.
 *
 * INVARIANT: no action in this file writes a `sets` row — ADR 0010. Starting a
 *            session from a template creates the session and nothing else; the
 *            sets appear when the user does the work.
 */

/** Zod says what is wrong in a sentence; anything else gets a plain fallback. */
function explain(cause: unknown, fallback: string): string {
  if (cause instanceof z.ZodError) {
    const issue = cause.issues[0];
    return issue ? `${issue.path.join('.') || 'form'}: ${issue.message}` : fallback;
  }
  return cause instanceof Error ? cause.message : fallback;
}

/** Build one by hand: the items come from the browser as JSON and are re-parsed. */
export async function createUserTemplate(
  _previous: TemplateFormState,
  formData: FormData
): Promise<TemplateFormState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  let templateId: string;
  try {
    const notes = String(formData.get('notes') ?? '').trim();
    // The client is not trusted with the shape even though this server rendered
    // the form that produced it — the rule confirmParsedSets() already follows.
    const draft = templateDraftSchema.parse({
      name: String(formData.get('name') ?? ''),
      source: 'user',
      notes: notes === '' ? null : notes,
      items: JSON.parse(String(formData.get('items') ?? '[]')) as unknown,
    });
    templateId = await createTemplate(db, user.id, draft);
  } catch (cause) {
    return { error: explain(cause, 'Could not save that template.') };
  }

  revalidatePath('/workout');
  redirect(`/workout/${templateId}`);
}

/**
 * Save a session that has already happened.
 *
 * The prescription is derived from the logged sets by `templateFromSession()` —
 * arithmetic over rows the user has already seen, so what comes back is
 * recognisably the session they did.
 */
export async function createTemplateFromSession(
  _previous: TemplateFormState,
  formData: FormData
): Promise<TemplateFormState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  let templateId: string;
  try {
    const workoutId = String(formData.get('workoutId') ?? '');
    // RLS returns nothing for someone else's session, so a forged id is the
    // same as a missing one.
    const workout = await loadWorkout(db, workoutId);
    if (!workout) return { error: 'That session could not be found.' };

    const derived = templateFromSession(workout.sets);
    if (derived.items.length === 0) {
      return {
        error:
          'That session has no working sets with reps recorded, so there is nothing to prescribe.',
      };
    }

    const name = String(formData.get('name') ?? '').trim();
    const draft = templateDraftSchema.parse({
      name: name === '' ? `Session of ${workout.localDate}` : name,
      source: 'user',
      notes: derived.truncated
        ? 'Saved from a session with more set groups than a template can hold; the last ones were dropped.'
        : null,
      items: derived.items,
    });
    templateId = await createTemplate(db, user.id, draft);
  } catch (cause) {
    return { error: explain(cause, 'Could not save that session as a template.') };
  }

  revalidatePath('/workout');
  redirect(`/workout/${templateId}`);
}

/**
 * Import one session of the coach's accepted plan.
 *
 * INVARIANT: no model is called — CLAUDE.md #1. The block was accepted when the
 *            planner ran; this reads the row, resolves slugs against the
 *            catalogue and copies the numbers. The week and day arrive as
 *            indices and are looked up server-side, so the browser cannot
 *            supply a prescription of its own.
 */
export async function createTemplateFromPlan(
  _previous: TemplateFormState,
  formData: FormData
): Promise<TemplateFormState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  let templateId: string;
  try {
    const weekNumber = Number(formData.get('weekNumber'));
    const dayIndex = Number(formData.get('dayIndex'));

    const plan = await latestAcceptedPlan(db);
    if (!plan) return { error: 'There is no accepted plan to import from yet.' };

    const week = plan.block.weeks.find((w) => w.week_number === weekNumber);
    const session = week?.sessions.find((s) => s.day_index === dayIndex);
    if (!week || !session) return { error: 'That session is not in the current plan.' };

    const ids = await exerciseIdsBySlug(
      db,
      session.exercises.map((e) => e.exercise_slug)
    );
    const imported = templateFromPlannedSession(session, week.week_number, ids);
    if (!imported.ok) {
      // Named rather than skipped: a pressing day arriving without its press
      // would look like a plan the coach wrote — src/templates/plan.ts.
      return { error: `The catalogue has no exercise for: ${imported.missingSlugs.join(', ')}.` };
    }

    const draft = templateDraftSchema.parse({
      name: imported.name,
      source: 'coach',
      notes: null,
      items: imported.items,
    });
    templateId = await createTemplate(db, user.id, draft);
  } catch (cause) {
    return { error: explain(cause, 'Could not import that session.') };
  }

  revalidatePath('/workout');
  redirect(`/workout/${templateId}`);
}

/**
 * The payoff: one tap from a template to a session in progress.
 *
 * This is `startWorkout()` plus `template_id`, deliberately — the same insert,
 * the same status, the same local date. INVARIANT: the user's local date, not
 * the server's — CLAUDE.md #9.
 */
export async function startFromTemplate(formData: FormData): Promise<void> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const templateId = String(formData.get('templateId') ?? '');

  const { data, error } = await db
    .from('workouts')
    .insert({
      user_id: user.id,
      local_date: localDateFor(user.timezone),
      status: 'in_progress',
      started_at: new Date().toISOString(),
      // RLS rejects a template id belonging to anyone else, so this cannot
      // borrow another user's prescription.
      template_id: templateId,
    })
    .select('id')
    .single();

  if (error) throw new Error(`starting workout from template: ${error.message}`);

  revalidatePath('/history');
  redirect(`/history/${data.id}`);
}

export async function removeTemplate(formData: FormData): Promise<void> {
  const db = await createServerDb();
  // No user_id filter: RLS already scopes the delete to rows this user owns.
  await deleteTemplate(db, String(formData.get('templateId') ?? ''));

  revalidatePath('/workout');
  redirect('/workout');
}
