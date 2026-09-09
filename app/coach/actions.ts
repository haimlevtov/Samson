'use server';

import { redirect } from 'next/navigation';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { createSupabaseLedger } from '@/src/db/ledger';
import { loadXpSummary } from '@/src/db/gamification';
import { latestAcceptedPlan, listPersonas } from '@/src/db/personas';
import { listWorkouts, loadHistory } from '@/src/db/training';
import { callLLM, createGatewayDeps } from '@/src/llm/gateway';
import {
  MAX_CHAT_MESSAGE_CHARS,
  MAX_DIET_QUESTION_CHARS,
  MissingApiKeyError,
} from '@/src/llm/config';
import { explainTarget } from '@/src/diet/advice';
import { computeEnergy } from '@/src/diet/energy';
import { dietQuestionSchema } from '@/src/diet/schema';
import { EMPTY_DIET, type DietState } from './diet-state';
import { BudgetExceededError } from '@/src/llm/types';
import { coachFacts } from '@/src/chat/facts';
import { askCoach } from '@/src/chat/reply';
import { MAX_TRANSCRIPT_TURNS, chatHistorySchema, type ChatTurn } from '@/src/chat/schema';
import { EMPTY_CHAT, type ChatState } from './chat-state';
import { adherence } from '@/src/metrics/adherence';
import { addDays } from '@/src/metrics/dates';
import { deliverPlan } from '@/src/persona/deliver';
import type { HumorLevel } from '@/src/persona/schema';
import { EMPTY_DELIVERY, type DeliveryState } from './state';

const ADHERENCE_WINDOW_DAYS = 28;
/** Notes older than this say nothing about how someone feels today. */
const RECENT_NOTES = 5;

/**
 * One turn of the coach chat — ADR 0015, docs/specs/coach-chat.md.
 *
 * INVARIANT: this action has no write path to the user's training data, and
 *            adding one would break the guarantees in ADR 0015's table. It
 *            reads the user's own rows, calls one stage, and returns prose.
 *            The one insert underneath it is the `llm_calls` ledger row the
 *            gateway writes per attempt, which invariant #3 requires and which
 *            no model chooses the shape of.
 *
 * INVARIANT: the transcript arriving in `previous` is USER INPUT. It is held by
 *            the client precisely because nothing stores it, so it is parsed by
 *            `chatHistorySchema` before it is used and fenced turn by turn
 *            afterwards. A `coach` role in it is a claim, not a provenance.
 */
export async function sendChatMessage(previous: ChatState, formData: FormData): Promise<ChatState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  // One action drives the panel, so "clear" is an intent on the same form
  // rather than a second action: useActionState owns the state, and a second
  // action could not reach it.
  if (formData.get('intent') === 'clear') return EMPTY_CHAT;

  const message = String(formData.get('message') ?? '').trim();

  // Parsed, not trusted — see the invariant above. A malformed transcript is
  // dropped rather than repaired: continuing from a conversation we cannot
  // read is worse than starting a fresh one.
  //
  // `previous` itself is optional-chained because it is client-supplied state,
  // not a value this code produced: a crafted POST with a null previous state
  // would otherwise throw a TypeError outside this function's try/catch and
  // return a framework 500 instead of the generic string below.
  const parsed = chatHistorySchema.safeParse((previous as { turns?: unknown } | null)?.turns);
  const turns: ChatTurn[] = parsed.success ? parsed.data : [];

  if (message === '') return { turns, error: null };
  if (message.length > MAX_CHAT_MESSAGE_CHARS) {
    // Rejected rather than silently truncated: the user should know the coach
    // did not read the second half of what they wrote.
    return {
      turns,
      error: `That is longer than the ${MAX_CHAT_MESSAGE_CHARS} characters the coach reads at once.`,
    };
  }

  const today = localDateFor(user.timezone);
  const [history, xp] = await Promise.all([loadHistory(db), loadXpSummary(db, today)]);

  // INVARIANT: every figure the coach may quote is computed here, in code —
  //            CLAUDE.md #1. The model receives them; it does not derive them.
  const facts = coachFacts({
    today,
    workouts: history.workouts,
    sets: history.sets,
    exerciseNames: new Map([...history.exercises].map(([id, e]) => [id, e.name])),
    lifetimeXp: xp.lifetime,
  });

  // Optimistic: the user's own turn is shown whatever happens next, so a failed
  // call does not swallow what they typed.
  const withUser: ChatTurn[] = [...turns, { role: 'user', text: message }];
  const trim = (all: ChatTurn[]): ChatTurn[] => all.slice(-MAX_TRANSCRIPT_TURNS);

  try {
    const answer = await askCoach(
      user.id,
      { facts, history: turns, message },
      { call: (options) => callLLM(options, createGatewayDeps(createSupabaseLedger(db))) }
    );

    return {
      turns: trim([...withUser, { role: 'coach', text: answer.text }]),
      error: null,
    };
  } catch (cause) {
    /*
     * Two errors are worth showing verbatim, and everything else is not.
     *
     * MissingApiKeyError says exactly what to do and names no internals; it is
     * the common case in development. BudgetExceededError reports the user
     * their OWN weekly spend, which they are entitled to and which explains a
     * refusal that would otherwise look like a bug.
     *
     * WHY the rest are generic — FOUND IN TESTING: a database error arrived in
     * the browser reading "llm_calls insert failed: new row for relation
     * \"llm_calls\" violates check constraint \"llm_calls_stage_check\"", which
     * hands a user table names, column semantics and constraint names for a
     * table they cannot read. Harmless on its own, and free reconnaissance in
     * quantity. The chat is also the surface somebody pokes at repeatedly, so
     * it is the one most likely to produce a variety of them.
     */
    if (cause instanceof MissingApiKeyError || cause instanceof BudgetExceededError) {
      return { turns: trim(withUser), error: cause.message };
    }

    // The detail is kept, just not sent to the browser.
    console.error('coach chat failed', cause);
    return {
      turns: trim(withUser),
      error: 'The coach could not answer that one. Try again in a moment.',
    };
  }
}

/**
 * The diet advisor — ADR 0024, docs/specs/diet.md.
 *
 * INVARIANT: the target is computed, clamped and RENDERED by code —
 *            CLAUDE.md #6. The model is called after the number exists, is
 *            given `dietFacts()` (categories, no figures), and its words are
 *            printed beside a figure it never saw. There is no path from the
 *            model's output to `targetKcal`, on the variable or on the screen.
 *
 * INVARIANT: the biometrics are read from the authenticated user's own row
 *            under RLS, never from a form field — CLAUDE.md #10. The form
 *            carries a goal and an optional question, and nothing else.
 */
export async function askDietAdvisor(_previous: DietState, formData: FormData): Promise<DietState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const goal = String(formData.get('goal') ?? 'maintain');
  const parsedQuestion = dietQuestionSchema.safeParse(formData.get('question') ?? '');
  if (!parsedQuestion.success) {
    return {
      ...EMPTY_DIET,
      goal,
      error: `That question is longer than the ${MAX_DIET_QUESTION_CHARS} characters this box reads.`,
    };
  }

  const today = localDateFor(user.timezone);
  const [history, xp] = await Promise.all([loadHistory(db), loadXpSummary(db, today)]);

  /*
   * The session count comes from `coachFacts`, which the chat on this same page
   * already computes — ADR 0024 §4. A second count here would be a second
   * definition of one number, and `src/chat/facts.ts` says why its window is 28
   * days: it matches what the Profile tab reports, so the two cannot disagree.
   */
  const facts = coachFacts({
    today,
    workouts: history.workouts,
    sets: history.sets,
    exerciseNames: new Map([...history.exercises].map(([id, e]) => [id, e.name])),
    lifetimeXp: xp.lifetime,
  });

  // INVARIANT: every figure is produced here, before a model is involved.
  const result = computeEnergy({
    today,
    bodyweightKg: user.bodyweightKg,
    heightCm: user.heightCm,
    birthDate: user.birthDate,
    sex: user.sex,
    sessionsLast28Days: facts.sessions_last_28_days,
    goal,
  });

  // A refusal is rendered by the panel in its own words. Nothing is sent to a
  // model: there is no target to explain, and asking one to comment on a
  // missing biometric would be paying for a sentence the app can write.
  if (result.kind !== 'ok') return { ...EMPTY_DIET, goal, result };

  try {
    const explanation = await explainTarget(user.id, result, parsedQuestion.data, {
      call: (options) => callLLM(options, createGatewayDeps(createSupabaseLedger(db))),
    });

    return {
      result,
      summary: explanation.summary,
      caveat: explanation.caveat,
      goal,
      error: null,
    };
  } catch (cause) {
    /*
     * The figures survive the failure, and that is the point of computing them
     * first: the target renders whether or not a model could be reached.
     *
     * The same two errors are worth showing verbatim as in `sendChatMessage`,
     * and everything else is generic for the reason recorded there.
     */
    if (cause instanceof MissingApiKeyError || cause instanceof BudgetExceededError) {
      return { result, summary: null, caveat: null, goal, error: cause.message };
    }

    console.error('diet advisor failed', cause);
    return {
      result,
      summary: null,
      caveat: null,
      goal,
      error: 'The coach could not put that into words. The figures above are still yours.',
    };
  }
}

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
    // The same allowlist `sendChatMessage` uses, and for the same reason —
    // this one was returning `cause.message` verbatim, which reaches the
    // browser as a raw Postgres error, or as the first 500 characters of an
    // upstream provider response body. FOUND IN REVIEW, 2026-09-07.
    if (cause instanceof MissingApiKeyError || cause instanceof BudgetExceededError) {
      return { ...EMPTY_DELIVERY, personaSlug: slug, error: cause.message };
    }

    console.error('persona delivery failed', cause);
    return {
      ...EMPTY_DELIVERY,
      personaSlug: slug,
      error: 'The coach could not deliver that plan. Try again in a moment.',
    };
  }
}
