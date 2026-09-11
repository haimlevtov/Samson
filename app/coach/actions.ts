'use server';

import { redirect } from 'next/navigation';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { createSupabaseLedger } from '@/src/db/ledger';
import { loadXpSummary } from '@/src/db/gamification';
import { coachVoice, latestAcceptedPlan, listPersonas } from '@/src/db/personas';
import { listWorkouts, loadHistory } from '@/src/db/training';
import { callLLM, callSpeech, createGatewayDeps } from '@/src/llm/gateway';
import { speechScript } from '@/src/speech/script';
import { refusalFor } from '@/src/speech/refusal';
import type { VoiceResult } from '@/src/speech/player';
import { MAX_CHAT_MESSAGE_CHARS, MissingApiKeyError } from '@/src/llm/config';
import { z } from 'zod';
import { DIET_GOALS, computeEnergy, dietFacts } from '@/src/diet/energy';
import { loadEvidence } from '@/src/db/evidence';
import { BudgetExceededError } from '@/src/llm/types';
import { coachFacts } from '@/src/chat/facts';
import { SUPPLEMENT_ANSWER_TURN, askCoach } from '@/src/chat/reply';
import { MAX_TRANSCRIPT_TURNS, chatHistorySchema, type ChatTurn } from '@/src/chat/schema';
import { EMPTY_COACH, type CoachState } from './coach-state';
import { adherence } from '@/src/metrics/adherence';
import { addDays } from '@/src/metrics/dates';
import { deliverPlan } from '@/src/persona/deliver';
import { asPersona, type HumorLevel } from '@/src/persona/schema';
import { EMPTY_DELIVERY, type DeliveryState } from './state';

const ADHERENCE_WINDOW_DAYS = 28;
/** Notes older than this say nothing about how someone feels today. */
const RECENT_NOTES = 5;

/**
 * One turn of the coach box — ADR 0015 §6, docs/specs/coach-chat.md.
 *
 * Replaces `sendChatMessage`, `askDietAdvisor` and `askAboutSupplement`. One
 * form, one action, one call: the route is the model's and the guard that runs
 * is the one belonging to the route it named.
 *
 * INVARIANT: this action has no write path to the user's training data, and
 *            adding one would break the guarantees in ADR 0015's table. It
 *            reads the user's own rows, calls one stage, and returns prose or a
 *            shared row. The one insert underneath it is the `llm_calls` ledger
 *            row the gateway writes per attempt, which invariant #3 requires
 *            and which no model chooses the shape of.
 *
 * INVARIANT: the transcript arriving in `previous` is USER INPUT. It is held by
 *            the client precisely because nothing stores it, so it is parsed by
 *            `chatHistorySchema` before it is used and fenced turn by turn
 *            afterwards. A `coach` role in it is a claim, not a provenance.
 *
 * INVARIANT: the calorie target is computed, clamped and RENDERED by code —
 *            CLAUDE.md #6. `computeEnergy` runs on EVERY submission, before any
 *            model is involved and whatever the question turns out to be, and
 *            the model is handed `dietFacts` — categories, no figures. There is
 *            no path from its output to the number on the screen.
 *
 * INVARIANT: the biometrics are read from the authenticated user's own row
 *            under RLS, never from a form field — CLAUDE.md #10. The form
 *            carries a goal, a message and an intent, and nothing else.
 */
export async function askTheCoach(previous: CoachState, formData: FormData): Promise<CoachState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  /*
   * FOUND IN REVIEW of the diet panel, and kept: this was a bare `String(...)`
   * while the spec said the action validates with `z.enum`. The safety outcome
   * survived — `normaliseGoal` falls to maintain for anything unrecognised — but
   * the named mechanism did not exist, and the raw string was echoed back into
   * the `<select>`, so a hand-posted `goal=banana` rendered a control with
   * nothing selected.
   *
   * `.catch` rather than a rejection: an unrecognised goal is not worth an error
   * message, and maintain is the safe direction.
   */
  const goal = z.enum(DIET_GOALS).catch('maintain').parse(formData.get('goal'));

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

  // One action drives the panel, so "clear" is an intent on the same form
  // rather than a second action: useActionState owns the state, and a second
  // action could not reach it. The goal survives it — clearing a conversation
  // is not a reason to forget which goal the figures below are for.
  if (formData.get('intent') === 'clear') return { ...EMPTY_COACH, goal };

  const message = String(formData.get('message') ?? '').trim();

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

  /*
   * INVARIANT: the figure exists before the model does — ADR 0024 §1. The
   *            session count comes from `coachFacts`, which this action already
   *            computes, so there is one definition of that number rather than
   *            two (ADR 0024 §4).
   */
  const result = computeEnergy({
    today,
    bodyweightKg: user.bodyweightKg,
    heightCm: user.heightCm,
    birthDate: user.birthDate,
    sex: user.sex,
    sessionsLast28Days: facts.sessions_last_28_days,
    goal,
  });

  /*
   * A goal change with nothing typed. The figures are recomputed and no model is
   * called, which is what makes the selector free to move: the old panel paid
   * for a sentence on every change, and a user comparing three goals paid three
   * times.
   */
  if (message === '') return { ...previous, turns, result, goal, error: null };

  if (message.length > MAX_CHAT_MESSAGE_CHARS) {
    // Rejected rather than silently truncated: the user should know the coach
    // did not read the second half of what they wrote.
    return {
      ...previous,
      turns,
      result,
      goal,
      error: `That is longer than the ${MAX_CHAT_MESSAGE_CHARS} characters the coach reads at once.`,
    };
  }

  // Optimistic: the user's own turn is shown whatever happens next, so a failed
  // call does not swallow what they typed.
  const withUser: ChatTurn[] = [...turns, { role: 'user', text: message }];
  const trim = (all: ChatTurn[]): ChatTurn[] => all.slice(-MAX_TRANSCRIPT_TURNS);

  try {
    /*
     * Both contexts are read before the call and for every question, because a
     * route is not known until the answer comes back — ADR 0015 §6. Neither is
     * expensive: `dietFacts` is a projection of a value already computed above,
     * and `loadEvidence` is one RLS-scoped read of shared rows.
     *
     * Inside the try, deliberately. `loadEvidence` throws with the raw Postgres
     * message, and an escaped rejection would bypass the generic error state
     * the rest of this action is careful to build.
     */
    const { rows } = await loadEvidence(db);

    const answer = await askCoach(
      user.id,
      {
        facts,
        history: turns,
        message,
        // Null when the engine refused: there is no target to explain, so the
        // panel renders the refusal in the app's own words instead.
        diet: result.kind === 'ok' ? dietFacts(result) : null,
        evidence: rows,
      },
      { call: (options) => callLLM(options, createGatewayDeps(createSupabaseLedger(db))) }
    );

    /*
     * The supplement route has no prose to show — the row is the answer — so
     * the transcript carries the constant that names what happened and the row
     * renders beside it. `answer.text` is null only on that route and only when
     * a row was found, which is exactly when there is something else to render.
     */
    const spoken = answer.text ?? SUPPLEMENT_ANSWER_TURN;

    return {
      turns: trim([...withUser, { role: 'coach', text: spoken }]),
      result,
      goal,
      row: answer.row,
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
     * quantity. The box is also the surface somebody pokes at repeatedly, so
     * it is the one most likely to produce a variety of them.
     *
     * The FIGURES SURVIVE every branch below, and that is the point of computing
     * them first: the target renders whether or not a model could be reached.
     */
    if (cause instanceof MissingApiKeyError || cause instanceof BudgetExceededError) {
      return { ...previous, turns: trim(withUser), result, goal, error: cause.message };
    }

    /*
     * The NAME and a bounded message, never the object.
     *
     * FOUND IN REVIEW, at three sites in turn. `LlmCallFailedError` declares
     * `attempts: LlmCallInsert[]`, an enumerable own property Node prints after
     * the stack, and every one of those rows carries `user_id`. Logging `cause`
     * wrote the user's auth UUID into the server log up to three times per
     * failure, plus up to 500 characters of upstream body — which providers
     * commonly fill with the request they rejected, and which here means free
     * text this feature's own adversarial list shows can be a health disclosure.
     */
    console.error(
      'coach box failed',
      cause instanceof Error ? `${cause.name}: ${cause.message.slice(0, 200)}` : 'unknown'
    );
    return {
      ...previous,
      turns: trim(withUser),
      result,
      goal,
      error: 'The coach could not answer that one. The figures above are still yours.',
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
  const listed = personas.find((p) => p.slug === slug);

  if (!listed) return { ...EMPTY_DELIVERY, error: 'That coach is not available.' };

  // INVARIANT: delivery gets only the fields it reads — not the preview line,
  //            which a user can write on their own row — CLAUDE.md #11.
  const persona = asPersona(listed);
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

    // Name and bounded message only — see `sendChatMessage` for what the object
    // carries. This was the third site with the same leak.
    console.error(
      'persona delivery failed',
      cause instanceof Error ? `${cause.name}: ${cause.message.slice(0, 200)}` : 'unknown'
    );
    return {
      ...EMPTY_DELIVERY,
      personaSlug: slug,
      error: 'The coach could not deliver that plan. Try again in a moment.',
    };
  }
}

/**
 * A coach's sample line, in the voice cast for it — ADR 0025.
 *
 * INVARIANT: the slug is the only thing the browser sends, and it only chooses
 *            among shared rows — `coachVoice` filters on `user_id is null`,
 *            ADR 0025 §4. The words spoken and the direction they are spoken
 *            with are the row's, so this cannot be used to speak anything else.
 *
 * INVARIANT: no write path but the ledger. The one insert underneath is the
 *            `llm_calls` row per attempt that CLAUDE.md #3 requires.
 */
export async function hearCoach(slug: unknown): Promise<VoiceResult> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  // Called directly rather than through a form, so the argument is whatever
  // the request carried — parsed, not trusted.
  const parsed = z.string().min(1).max(64).safeParse(slug);
  if (!parsed.success) return { ok: false, reason: 'no-voice' };

  try {
    const coach = await coachVoice(db, parsed.data);
    if (!coach) return { ok: false, reason: 'no-voice' };

    const spoken = await callSpeech(
      {
        userId: user.id,
        input: speechScript(coach.direction, coach.line),
        voice: coach.voice,
      },
      createGatewayDeps(createSupabaseLedger(db))
    );

    return { ok: true, audio: spoken.audio, contentType: spoken.contentType };
  } catch (cause) {
    // Refusals the card can explain are named; everything else is generic,
    // for the reason `sendChatMessage` gives — src/speech/refusal.ts.
    const reason = refusalFor(cause);

    if (reason === 'failed') {
      // Name and bounded message only — `LlmCallFailedError` carries every
      // ledger row, and every row carries the user's id. See `sendChatMessage`.
      console.error(
        'coach voice failed',
        cause instanceof Error ? `${cause.name}: ${cause.message.slice(0, 200)}` : 'unknown'
      );
    }
    return { ok: false, reason };
  }
}
