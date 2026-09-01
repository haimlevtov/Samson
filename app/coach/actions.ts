'use server';

import { redirect } from 'next/navigation';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { createSupabaseLedger } from '@/src/db/ledger';
import { latestAcceptedPlan, listPersonas } from '@/src/db/personas';
import { listWorkouts, loadHistory } from '@/src/db/training';
import { callLLM, createGatewayDeps } from '@/src/llm/gateway';
import { MissingApiKeyError } from '@/src/llm/config';
import { adherence } from '@/src/metrics/adherence';
import { addDays } from '@/src/metrics/dates';
import { deliverPlan } from '@/src/persona/deliver';
import type { HumorLevel } from '@/src/persona/schema';
import { EMPTY_DELIVERY, type DeliveryState } from './state';

const ADHERENCE_WINDOW_DAYS = 28;
/** Notes older than this say nothing about how someone feels today. */
const RECENT_NOTES = 5;

/**
 * Runs the persona stage over the newest accepted plan.
 *
 * INVARIANT: the block is not passed through the model and back — ADR 0006. It
 *            is read here, rendered by the page from the same object, and the
 *            persona returns prose alongside it.
 */
export async function deliverForPersona(
  _previous: DeliveryState,
  formData: FormData
): Promise<DeliveryState> {
  const slug = String(formData.get('personaSlug') ?? '');
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const [personas, plan] = await Promise.all([listPersonas(db), latestAcceptedPlan(db)]);
  const persona = personas.find((p) => p.slug === slug);

  if (!persona) return { ...EMPTY_DELIVERY, error: 'That coach is not available.' };
  if (!plan) {
    return { ...EMPTY_DELIVERY, personaSlug: slug, error: 'There is no accepted plan to deliver.' };
  }

  // The tone flags are computed from the log, deterministically, before any
  // model is involved — ADR 0006. The persona does not get a vote on them.
  const [history, workouts] = await Promise.all([loadHistory(db), listWorkouts(db, RECENT_NOTES)]);
  const today = localDateFor(user.timezone);
  const rate = adherence(history.workouts, {
    start: addDays(today, -(ADHERENCE_WINDOW_DAYS - 1)),
    end: today,
  }).rate;

  try {
    const result = await deliverPlan(
      user.id,
      {
        block: plan.block,
        persona,
        userHumorMax: user.humorMaxLevel as HumorLevel,
        tone: { notes: workouts.map((w) => w.notes), adherenceRate: rate },
      },
      { call: (options) => callLLM(options, createGatewayDeps(createSupabaseLedger(db))) }
    );

    return {
      personaSlug: slug,
      delivered: result.delivered,
      gentle: result.tone.gentle,
      error: null,
    };
  } catch (cause) {
    // Running without a key is the common case today, and it should say so
    // rather than surfacing a Postgres or transport error.
    if (cause instanceof MissingApiKeyError) {
      return { ...EMPTY_DELIVERY, personaSlug: slug, error: cause.message };
    }
    return {
      ...EMPTY_DELIVERY,
      personaSlug: slug,
      error: cause instanceof Error ? cause.message : 'The coach could not answer.',
    };
  }
}
