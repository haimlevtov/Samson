'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { insertSet } from '@/src/db/training';
import { awardSessionXp } from '@/src/db/gamification';
import { availableExercises } from '@/src/db/exercises';
import { createSupabaseLedger } from '@/src/db/ledger';
import { callLLM, createGatewayDeps } from '@/src/llm/gateway';
import { MissingApiKeyError } from '@/src/llm/config';
import { parseEntry } from '@/src/normalizer/parse';
import { normalizedSetSchema } from '@/src/normalizer/schema';
import { EMPTY_PARSE, type ParseState } from './parse-state';

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

  // One write path, shared with the normalizer — see src/db/training.ts.
  await insertSet(db, user.id, {
    workoutId,
    exerciseId,
    weightKg: number('weightKg'),
    reps: number('reps'),
    rpe: number('rpe'),
    restSeconds: number('restSeconds'),
    isWarmup,
  });

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

  /*
   * XP and achievements — ADR 0009.
   *
   * INVARIANT: this call passes a workout id and nothing else. Everything it
   *            writes, the RPC derives from rows already in the database. The
   *            browser does not get to say how much a session was worth.
   *
   * WHY the failure is swallowed rather than thrown: the workout is already
   * finished and saved at this point. Losing a reward is a disappointment;
   * throwing here would show the user an error page for a session that was
   * successfully recorded, and they would reasonably try to log it again.
   */
  let unlocked: string[] = [];
  try {
    const result = await awardSessionXp(db, workoutId);
    unlocked = result.unlocked;
  } catch (cause) {
    console.error('award_session_xp failed', cause);
  }

  revalidatePath('/workouts');
  revalidatePath('/hub');

  /*
   * The badge reveal — phase 4's "a badge visibly fires in the UI on unlock".
   *
   * WHY a query parameter is safe here: it selects which badge to REVEAL, and
   * the page renders it only after finding a matching row in this user's own
   * achievement_events (scoped by RLS). A forged slug shows nothing, because
   * the event has to exist. No schema change and no "seen" column.
   */
  const first = unlocked[0];
  redirect(first === undefined ? '/workouts' : `/workouts?unlocked=${encodeURIComponent(first)}`);
}

/**
 * Free-text set entry, step one: read it, do not write it.
 *
 * INVARIANT: nothing is stored until the user agrees — src/normalizer/schema.ts.
 *            A misheard set corrupts every metric downstream and they would not
 *            notice, so the interpretation comes back for confirmation and the
 *            write is a separate, explicit action.
 */
export async function parseFreeText(
  _previous: ParseState,
  formData: FormData
): Promise<ParseState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const text = String(formData.get('text') ?? '');

  try {
    // INVARIANT #5: the candidate list is equipment-filtered in SQL before the
    // model sees it, exactly as the picker and the planner use it.
    const candidates = await availableExercises(db, user.id);
    const result = await parseEntry(
      user.id,
      text,
      candidates.map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
      { call: (options) => callLLM(options, createGatewayDeps(createSupabaseLedger(db))) }
    );

    return {
      interpretation: result.entry.interpretation,
      exerciseId: result.exerciseId,
      exerciseName: result.exerciseName,
      sets: result.entry.sets,
      error: null,
    };
  } catch (cause) {
    // Running without a key is the common case today; say so plainly rather
    // than surfacing a transport error.
    if (cause instanceof MissingApiKeyError) return { ...EMPTY_PARSE, error: cause.message };
    return {
      ...EMPTY_PARSE,
      error: cause instanceof Error ? cause.message : 'Could not read that.',
    };
  }
}

/** Step two: write what was confirmed, through the one shared path. */
export async function confirmParsedSets(formData: FormData): Promise<void> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const workoutId = String(formData.get('workoutId') ?? '');
  const exerciseId = String(formData.get('exerciseId') ?? '');
  const parsed: unknown = JSON.parse(String(formData.get('sets') ?? '[]'));

  // Re-validated on the way in. The client is not trusted with the shape, even
  // though it was this server that produced it a moment ago.
  const sets = normalizedSetSchema.array().parse(parsed);

  for (const set of sets) {
    await insertSet(db, user.id, {
      workoutId,
      exerciseId,
      weightKg: set.weight_kg,
      reps: set.reps,
      rpe: set.rpe,
      restSeconds: null,
      isWarmup: set.is_warmup,
    });
  }

  revalidatePath(`/workouts/${workoutId}`);
}
