'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
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
import { EMPTY_PLAN, type PlanState } from './plan-state';
import { availableExercises } from '@/src/db/exercises';
import {
  PLAN_RUN_COOLDOWN_SECONDS,
  createSupabasePlanStore,
  startedPlanRunRecently,
} from '@/src/db/plans';
import { buildPlannerContext } from '@/src/planner/context';
import { PLAN_NOT_RECORDED, PLAN_OUT_OF_TIME, generatePlan } from '@/src/planner/loop';
import { planRequestFrom } from '@/src/planner/request';
import { WEB_PLAN_DEADLINE_MS, WEB_PLAN_MAX_ITERATIONS } from '@/src/llm/config';
import { adherence } from '@/src/metrics/adherence';
import { addDays } from '@/src/metrics/dates';
import { deliverPlan } from '@/src/persona/deliver';
import { asPersona, type HumorLevel } from '@/src/persona/schema';
import { EMPTY_DELIVERY, type DeliveryState } from './state';

const ADHERENCE_WINDOW_DAYS = 28;
/** Notes older than this say nothing about how someone feels today. */
const RECENT_NOTES = 5;

/**
 * What every return that is NOT a fresh supplement answer carries.
 *
 * INVARIANT: `row` is set ONLY from an `askCoach` answer, and no return in this
 *            file spreads `previous` — FOUND IN REVIEW, and it was the sharpest
 *            finding on this PR.
 *
 * WHY, in two parts. `previous` is CLIENT-SUPPLIED: the same reasoning that
 * makes the transcript untrusted (it is held by the browser because this stage
 * stores nothing) makes every other field of it untrusted too. A crafted POST
 * carrying a `row` of its own would have been handed straight back and rendered
 * by `EvidenceBody` — the component `/evidence` uses — as a curated, grade-A
 * health claim with a working DOI. Nothing in the old `askAboutSupplement` could
 * do that, because it never read its previous state at all.
 *
 * And even honestly: the surface renders the row against the NEWEST turn, so a
 * row carried forward past a failure would appear under the user's question
 * rather than under an answer to it.
 */
const ANSWERLESS = { row: null, supplementMiss: false } as const;

/**
 * The only `error` strings a plan run may show the user.
 *
 * Both are constants exported by the planner loop, which is what makes this a
 * check rather than a judgement — see the call site for what the alternative
 * leaked.
 */
function sayable(result: {
  status: string;
  error: string | null;
  recorded: boolean;
}): string | null {
  if (!result.recorded) return PLAN_NOT_RECORDED;
  if (result.status === 'accepted') return null;
  return result.error === PLAN_OUT_OF_TIME ? PLAN_OUT_OF_TIME : null;
}

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
  if (message === '') return { turns, result, goal, ...ANSWERLESS, error: null };

  if (message.length > MAX_CHAT_MESSAGE_CHARS) {
    // Rejected rather than silently truncated: the user should know the coach
    // did not read the second half of what they wrote.
    return {
      turns,
      result,
      goal,
      ...ANSWERLESS,
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
      // The route is known HERE and nowhere else. The surface renders the
      // `/evidence` link from this rather than by recognising the constant's
      // text, which a user could type themselves — see `coach-state.ts`.
      supplementMiss: answer.route === 'supplement' && answer.row === null,
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
      return { turns: trim(withUser), result, goal, ...ANSWERLESS, error: cause.message };
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
      turns: trim(withUser),
      result,
      goal,
      ...ANSWERLESS,
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
    // The same allowlist `askTheCoach` uses, and for the same reason —
    // this one was returning `cause.message` verbatim, which reaches the
    // browser as a raw Postgres error, or as the first 500 characters of an
    // upstream provider response body. FOUND IN REVIEW, 2026-09-07.
    if (cause instanceof MissingApiKeyError || cause instanceof BudgetExceededError) {
      return { ...EMPTY_DELIVERY, personaSlug: slug, error: cause.message };
    }

    // Name and bounded message only — see `askTheCoach` for what the object
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
    // for the reason `askTheCoach` gives — src/speech/refusal.ts.
    const reason = refusalFor(cause);

    if (reason === 'failed') {
      // Name and bounded message only — `LlmCallFailedError` carries every
      // ledger row, and every row carries the user's id. See `askTheCoach`.
      console.error(
        'coach voice failed',
        cause instanceof Error ? `${cause.name}: ${cause.message.slice(0, 200)}` : 'unknown'
      );
    }
    return { ok: false, reason };
  }
}

/**
 * Generate a plan from the questionnaire — rework PR 8b,
 * [ADR 0027](../../docs/adr/0027-planner-in-a-function.md).
 *
 * `docs/specs/coach-chat.md` §1 argued this should not exist, and the argument
 * was right about the arithmetic: three planner+critic rounds at their
 * configured timeouts is 540s against a 60s function ceiling. What makes it fit
 * is a budget — one iteration, a four-week block, and a wall-clock deadline
 * enforced inside the loop — and what that costs is in the ADR's table.
 *
 * INVARIANT: the block is NOT returned through this action's state — it is a
 *            `plan_runs` row, and the page re-reads it. A block arriving through
 *            client state would be a training plan whose provenance is a POST.
 *
 * INVARIANT: every figure in the block comes from the model INSIDE the planner
 *            pipeline, checked by `checkRules` and the critic before it is
 *            stored — CLAUDE.md #1 and #5. This action chooses none of it; it
 *            supplies four answers and the candidate list.
 *
 * INVARIANT: the candidates are equipment-filtered in SQL before the model sees
 *            anything — CLAUDE.md #5. `availableExercises` does it, and an empty
 *            list refuses the run rather than sending it.
 */
export async function requestPlan(_previous: PlanState, formData: FormData): Promise<PlanState> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const parsed = planRequestFrom(formData);
  if (!parsed.success) {
    // Nothing was sent, so nothing was spent. The control's own bounds make this
    // unreachable by hand; a crafted POST reaches it.
    return {
      ...EMPTY_PLAN,
      outcome: 'invalid',
      error: 'Those answers did not add up to a request. Check the form and try again.',
    };
  }

  const request = parsed.data;
  const today = localDateFor(user.timezone);

  /*
   * The deadline is wall-clock from HERE, not from where `generatePlan` starts.
   * FOUND IN REVIEW: the reads and the context build happen before the loop, so
   * a slow cold start plus `loadHistory` plus the candidate join were outside the
   * budget entirely — and `page.tsx`'s comment claiming the 15s gap covered them
   * was asserting what it did not measure. Slow pre-work now shortens the loop
   * rather than the function.
   */
  const startedAt = Date.now();

  try {
    /*
     * Inside the try, all of it. FOUND IN REVIEW: these reads sat above it, so a
     * transient database error escaped `PlanState` and took the whole Coach page
     * to the error boundary — losing the questionnaire and the answers just
     * typed, for a failure that cost nothing and could have rendered in place.
     */
    const [history, candidates] = await Promise.all([
      loadHistory(db),
      availableExercises(db, user.id),
    ]);

    /*
     * ADR 0027 §5: no candidates, no call. `availableExercises` returns an empty
     * list for a user with no `user_equipment` rows, and invariant #5 means the
     * planner may only pick from that list — so a run against nothing cannot
     * produce a valid block, and sending it would buy a guaranteed rejection.
     *
     * It was a named state rather than a defensive branch because nothing but
     * `scripts/seed.ts` wrote that table. The picker (ADR 0029) changed that, and
     * the state stays: a user can still have saved nothing, which is the honest
     * answer to "I have no equipment" — the difference is that the card can now
     * point them somewhere.
     */
    if (candidates.length === 0) {
      return { ...EMPTY_PLAN, outcome: 'no-equipment' };
    }

    /*
     * One run at a time — FOUND IN REVIEW, and it is the finding with money
     * attached. `disabled={pending}` is client state and this action is a plain
     * endpoint, so a second tab, an impatient double-click or a scripted POST
     * started as many concurrent runs as it liked — and `enforceBudget` reads
     * spend then allows, so every one of them passed the gate on the same stale
     * figure. At ~6,000 planner tokens a call against a $0.50 weekly ceiling,
     * that is the cheapest expensive mistake in the app.
     *
     * Not a lock and not a queue (CLAUDE.md puts those out of scope): one
     * RLS-scoped indexed read of a table this run is about to write anyway.
     */
    if (await startedPlanRunRecently(db, PLAN_RUN_COOLDOWN_SECONDS)) {
      return { ...EMPTY_PLAN, outcome: 'already-running' };
    }

    const context = buildPlannerContext({
      goal: request.goal,
      daysPerWeek: request.days_per_week,
      blockWeeks: request.block_weeks,
      injuredJoints: request.injured_joints,
      asOf: today,
      workouts: history.workouts,
      sets: history.sets,
      candidates: candidates.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        primaryMuscle: c.primaryMuscle,
        movementPattern: c.movementPattern,
        equipment: c.equipment,
      })),
    });

    const result = await generatePlan(
      user.id,
      context.plannerInput,
      context.ruleContext,
      {
        call: (options) => callLLM(options, createGatewayDeps(createSupabaseLedger(db))),
        plans: createSupabasePlanStore(db),
      },
      /*
       * The whole reason this action can exist — ADR 0027 §1 and §2.
       *
       * `maxAttempts: 1` is not optional decoration. `timeoutMs` is a PER-ATTEMPT
       * abort in the gateway, which retries a timeout up to three times, so a
       * deadline expressed only through it bounds one attempt — three of a 45s
       * allowance is ~136s against a 60s ceiling. FOUND IN REVIEW.
       */
      {
        maxIterations: WEB_PLAN_MAX_ITERATIONS,
        maxAttempts: 1,
        deadlineMs: WEB_PLAN_DEADLINE_MS - (Date.now() - startedAt),
      }
    );

    /*
     * FOUND BY READING, before review: without this the accepted case did
     * nothing visible. `useActionState` returns state to the client; it does not
     * re-run the server component, so a plan that was written and stored would
     * have left the questionnaire sitting there looking as though the press had
     * been ignored — and `PlanRequest` renders no sentence for `accepted`
     * precisely because the plan itself is supposed to appear.
     *
     * That is the dead end ADR 0027 §4 forbids, arriving by omission rather than
     * by design. Both routes read `latestAcceptedPlan`: `/coach` renders the
     * block, and `/workout`'s template import offers its sessions.
     */
    if (result.status === 'accepted') {
      revalidatePath('/coach');
      revalidatePath('/workout');
    }

    return {
      outcome: result.status,
      rejectionCount: result.rejections.length,
      /*
       * ONLY the loop's own constants cross, never `result.error` as it comes.
       *
       * FOUND IN REVIEW, and the comment here used to get it exactly backwards:
       * it said the gateway "already bounds" that string. The gateway bounds its
       * LENGTH, not its content — `LlmCallFailedError.message` embeds up to 500
       * characters of the upstream response body, which providers fill with
       * model ids, quota text and the request they rejected. And the action's
       * own catch never saw it, because the loop RETURNS those rather than
       * throwing. This is the same leak class already fixed at three sites in
       * this file.
       *
       * Comparing against a constant is a check. Trusting a string's provenance
       * is not.
       */
      error: sayable(result),
    };
  } catch (cause) {
    // The same allowlist every other action on this page uses, for the reason
    // `askTheCoach` records: a raw error here would hand a user constraint and
    // column names for tables they cannot read.
    if (cause instanceof MissingApiKeyError || cause instanceof BudgetExceededError) {
      return { ...EMPTY_PLAN, outcome: 'failed', error: cause.message };
    }

    // Name and bounded message only — `LlmCallFailedError` carries every ledger
    // row and every row carries the user's id. See `askTheCoach`.
    console.error(
      'plan request failed',
      cause instanceof Error ? `${cause.name}: ${cause.message.slice(0, 200)}` : 'unknown'
    );
    return {
      ...EMPTY_PLAN,
      outcome: 'failed',
      /*
       * "Nothing was saved" was here and was not knowable — FOUND IN REVIEW. A
       * throw at this point may follow two paid model calls and a written
       * `plan_runs` row, so the sentence claimed something the code could not
       * check. What IS true is that the page has no plan to show.
       */
      error: 'That did not finish. Try again in a moment.',
    };
  }
}
