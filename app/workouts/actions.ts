'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';

/**
 * Every write in this file runs on the request-scoped, RLS-bound client.
 *
 * INVARIANT: application code never uses the service role — CLAUDE.md #10.
 * The `user_id` values below are taken from the verified session, and the RLS
 * policy independently rejects any row whose user_id is not auth.uid(), so a
 * forged form field cannot write to someone else's log.
 */

export async function startWorkout(): Promise<void> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  // INVARIANT: the user's local date, not the server's — CLAUDE.md #9.
  const localDate = localDateFor(user.timezone);

  const { data, error } = await db
    .from('workouts')
    .insert({
      user_id: user.id,
      local_date: localDate,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`starting workout: ${error.message}`);

  revalidatePath('/workouts');
  redirect(`/workouts/${data.id}`);
}

export async function logSet(formData: FormData): Promise<void> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const workoutId = String(formData.get('workoutId') ?? '');
  const exerciseId = String(formData.get('exerciseId') ?? '');
  const isWarmup = formData.get('isWarmup') === 'on';

  const number = (key: string): number | null => {
    const raw = String(formData.get(key) ?? '').trim();
    if (raw === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  // The next index for this exercise within this session. Read rather than
  // counted client-side so two tabs cannot collide on the unique constraint.
  const { data: existing } = await db
    .from('sets')
    .select('set_index')
    .eq('workout_id', workoutId)
    .eq('exercise_id', exerciseId)
    .order('set_index', { ascending: false })
    .limit(1);

  const nextIndex = (existing?.[0]?.set_index ?? -1) + 1;

  const { error } = await db.from('sets').insert({
    user_id: user.id,
    workout_id: workoutId,
    exercise_id: exerciseId,
    set_index: nextIndex,
    // INVARIANT: stored canonically in kg — CLAUDE.md #8.
    weight_kg: number('weightKg'),
    reps: number('reps'),
    rpe: number('rpe'),
    rest_seconds: number('restSeconds'),
    is_warmup: isWarmup,
    completed_at: new Date().toISOString(),
  });

  if (error) throw new Error(`logging set: ${error.message}`);
  revalidatePath(`/workouts/${workoutId}`);
}

export async function deleteSet(formData: FormData): Promise<void> {
  const db = await createServerDb();
  const setId = String(formData.get('setId') ?? '');
  const workoutId = String(formData.get('workoutId') ?? '');

  // No user_id filter: RLS already scopes the delete to rows this user owns.
  const { error } = await db.from('sets').delete().eq('id', setId);
  if (error) throw new Error(`deleting set: ${error.message}`);

  revalidatePath(`/workouts/${workoutId}`);
}

export async function finishWorkout(formData: FormData): Promise<void> {
  const db = await createServerDb();
  const workoutId = String(formData.get('workoutId') ?? '');
  const notes = String(formData.get('notes') ?? '').trim();

  const { error } = await db
    .from('workouts')
    .update({
      status: 'completed',
      ended_at: new Date().toISOString(),
      // AI-NOTE: untrusted free text and a prompt-injection surface for the
      //          adversarial suite. Never interpolate into a system prompt.
      notes: notes === '' ? null : notes,
    })
    .eq('id', workoutId);

  if (error) throw new Error(`finishing workout: ${error.message}`);

  revalidatePath('/workouts');
  redirect('/workouts');
}
