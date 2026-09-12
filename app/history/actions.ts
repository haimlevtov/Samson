'use server';

import { z } from 'zod';
import { redirect, unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { activeWorkout, insertSet } from '@/src/db/training';
import { awardSessionXp } from '@/src/db/gamification';
import { availableExercises } from '@/src/db/exercises';
import { createSupabaseLedger } from '@/src/db/ledger';
import { callLLM, callSpeech, createGatewayDeps } from '@/src/llm/gateway';
import { loadXpSummary } from '@/src/db/gamification';
import { loadHistory } from '@/src/db/training';
import { loadEvidence } from '@/src/db/evidence';
import { loadNotes, rememberNote } from '@/src/db/notes';
import { coachVoice, listPersonas } from '@/src/db/personas';
import { coachFacts } from '@/src/chat/facts';
import { SUPPLEMENT_ANSWER_TURN, askCoach } from '@/src/chat/reply';
import { computeEnergy, dietFacts } from '@/src/diet/energy';
import { speechScript, spokenLine, MAX_TRANSCRIPT_CHARS } from '@/src/speech/script';
import { spokeToCoachRecently, SESSION_COACH_COOLDOWN_SECONDS } from '@/src/db/plans';
import { refusalFor } from '@/src/speech/refusal';
import { MAX_CHAT_MESSAGE_CHARS } from '@/src/llm/config';
import type { SessionAnswer } from './session-coach';
import { isUserFacing, logLine, userFacingError } from '@/src/llm/failure';
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

  /*
   * One session at a time.
   *
   * WHY resume rather than start a second: a workout is a thing you are in the
   * middle of, and there is no such thing as being in the middle of two. The
   * old behaviour inserted a row on every press, so a stray tap on the way back
   * from the water fountain silently orphaned the sets already logged — they
   * stayed on a session the user had navigated away from and would not think to
   * look for.
   */
  const active = await activeWorkout(db);
  if (active !== null) redirect(`/history/${active.id}`);

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

  revalidatePath('/history');
  // Starting one flips /workout from Start to Resume — see finishWorkout.
  revalidatePath('/workout');
  redirect(`/history/${data.id}`);
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

  revalidatePath(`/history/${workoutId}`);
}

export async function deleteSet(formData: FormData): Promise<void> {
  const db = await createServerDb();
  const setId = String(formData.get('setId') ?? '');
  const workoutId = String(formData.get('workoutId') ?? '');

  // No user_id filter: RLS already scopes the delete to rows this user owns.
  const { error } = await db.from('sets').delete().eq('id', setId);
  if (error) throw new Error(`deleting set: ${error.message}`);

  revalidatePath(`/history/${workoutId}`);
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
    // ADR 0028's log clause, in the file that PR is about. This logged the
    // whole object: a wrapped Error here, so no enumerable ledger rows and no
    // user id — but an unbounded raw Postgres message, stack and all.
    console.error('award_session_xp failed', logLine(cause));
  }

  revalidatePath('/history');
  revalidatePath('/hub');
  // /workout renders Start or Resume from the active session, so finishing one
  // changes that page too. Masked today by force-dynamic and Next's cache
  // defaults, which is not the same as being correct.
  revalidatePath('/workout');

  /*
   * The badge reveal — phase 4's "a badge visibly fires in the UI on unlock".
   *
   * WHY a query parameter is safe here: it selects which badge to REVEAL, and
   * the page renders it only after finding a matching row in this user's own
   * achievement_events (scoped by RLS). A forged slug shows nothing, because
   * the event has to exist. No schema change and no "seen" column.
   */
  const first = unlocked[0];
  redirect(first === undefined ? '/history' : `/history?unlocked=${encodeURIComponent(first)}`);
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
    /*
     * ADR 0028. This returned `cause.message` for everything that was not a
     * missing key, so a raw Postgres error — table names, column semantics,
     * constraint names — or up to 500 characters of upstream provider body
     * reached the browser. It is the ninth site of this shape — ADR 0028
     * tabulates eight before it — which is why the judgement now lives in a
     * tested module instead of in another copy of this `catch`.
     *
     * `BudgetExceededError` used to reach the user here only by accident: it is
     * an Error, so the fall-through showed its message. That was the right
     * outcome for the wrong reason — `isUserFacing` names it deliberately now.
     *
     * The FIGURES do not survive this failure the way the diet target does
     * (ADR 0028 §3): nothing was parsed, so there is nothing to render beside a
     * sentence, and the sentence is the whole answer.
     */
    console.error('free-text parse failed', logLine(cause));

    return {
      ...EMPTY_PARSE,
      error: userFacingError(
        cause,
        'Could not read that. Try writing the set as "3x5 at 60" and log it again.'
      ),
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

  revalidatePath(`/history/${workoutId}`);
}

/**
 * One question asked out loud during a session — [ADR 0031](../../docs/adr/0031-talking-during-a-session.md).
 *
 * INVARIANT: the server never speaks text the browser sent — ADR 0025 §4, and
 *            it is what shapes this function. The browser sends a QUESTION; the
 *            answer is generated here and passed to `callSpeech` without ever
 *            leaving the server. There is no argument to this action that
 *            becomes something the project's key says out loud.
 *
 * INVARIANT: the transcript is a message like any other — ADR 0031 §6. Same
 *            stage, same fencing, same route guards, same memory rules. Speaking
 *            it rather than typing it changes how it arrived and nothing else.
 *
 * Called directly rather than through a form, so every argument is parsed.
 */
export async function askDuringSession(
  spoken: unknown,
  wantsVoice: unknown
): Promise<SessionAnswer> {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  /*
   * Trimmed BEFORE the length check — FOUND IN REVIEW. `min(1)` on an untrimmed
   * string admits a whitespace-only POST, which buys a whole chat call for a
   * question with nothing in it. `askTheCoach` trims and returns first.
   */
  const parsed = z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(MAX_CHAT_MESSAGE_CHARS))
    .safeParse(spoken);

  if (!parsed.success) {
    return {
      // Echoed even here — FOUND IN REVIEW. A transcript that failed the LENGTH
      // check is a recogniser that ran away, which is precisely the state where
      // the user most needs to see what was heard. ADR 0031 promises it.
      asked: typeof spoken === 'string' ? spoken.slice(0, 120) : '',
      reply: '',
      audio: null,
      silent: 'not-asked',
      coach: null,
      error: 'That did not come through as a question. Say it again.',
    };
  }

  const asked = parsed.data;
  const speak = wantsVoice === true;

  try {
    const today = localDateFor(user.timezone);

    /*
     * The cooldown `requestPlan` already has, for the reason its comment calls
     * "the finding with money attached" — FOUND IN REVIEW, and this action needs
     * it more. One press is up to six chat calls plus two speech attempts, the
     * budget gate reads spend before it allows (the unreserved gap ADR 0025
     * names), and this is the action ADR 0031 itself calls the first that can
     * spend the whole key in one session. `disabled={pending}` is client state
     * on one tab and stops nobody scripting a POST.
     */
    if (await spokeToCoachRecently(db, SESSION_COACH_COOLDOWN_SECONDS)) {
      return {
        asked,
        reply: '',
        audio: null,
        silent: 'not-asked',
        coach: null,
        error: 'One question at a time — give the last one a moment.',
      };
    }

    const [history, xp, evidence, notes, personas] = await Promise.all([
      loadHistory(db),
      loadXpSummary(db, today),
      loadEvidence(db),
      loadNotes(db),
      listPersonas(db),
    ]);

    // INVARIANT: every figure the coach may quote is computed here, in code —
    //            CLAUDE.md #1. Identical to the Coach tab's, because it is the
    //            same stage answering the same kind of question.
    const facts = coachFacts({
      today,
      workouts: history.workouts,
      sets: history.sets,
      exerciseNames: new Map([...history.exercises].map(([id, e]) => [id, e.name])),
      lifetimeXp: xp.lifetime,
    });

    /*
     * The diet goal is not asked for here: there is no selector on a session
     * screen and inventing one would be inventing a preference. `maintain` is
     * the same fallback `askTheCoach` falls to for an unrecognised value, and
     * the figure is the app's either way — the model is never shown it.
     */
    const energy = computeEnergy({
      today,
      bodyweightKg: user.bodyweightKg,
      heightCm: user.heightCm,
      birthDate: user.birthDate,
      sex: user.sex,
      sessionsLast28Days: facts.sessions_last_28_days,
      goal: 'maintain',
    });

    const answer = await askCoach(
      user.id,
      {
        facts,
        // No transcript: the session card holds one conversation on screen, and
        // replaying it would mean trusting the client with history on a surface
        // that has no Clear button to escape it. Each question stands alone.
        history: [],
        message: asked,
        diet: energy.kind === 'ok' ? dietFacts(energy) : null,
        evidence: evidence.rows,
        notes: notes.map((note) => note.text),
      },
      { call: (options) => callLLM(options, createGatewayDeps(createSupabaseLedger(db))) }
    );

    // ADR 0030, and the same rules as the Coach tab — nothing about this surface
    // relaxes them. Its own try/catch for the same reason: a note is a side
    // effect of an answer the user is waiting for.
    if (answer.remember !== null) {
      try {
        await rememberNote(db, user.id, answer.remember);
      } catch (cause) {
        console.error('session note not stored', logLine(cause));
      }
    }

    /*
     * The supplement route has no home here — FOUND IN REVIEW. Its answer is the
     * ROW (claim, grade, dose, citation), which the Coach tab renders beneath
     * the constant and this card has nowhere to put. Returning
     * `SUPPLEMENT_ANSWER_TURN` announced a table that would never appear, and
     * with the toggle on the app paid two cents to SAY so.
     *
     * A code-owned sentence instead, pointing at the surface that can show it. A
     * session screen is not where somebody reads a citation.
     */
    const reply =
      answer.route === 'supplement' && answer.row !== null
        ? 'The evidence table has an answer for that one — it is on the Coach tab.'
        : (answer.text ?? SUPPLEMENT_ANSWER_TURN);

    /*
     * The first persona alphabetically — ADR 0031 §5. There is no stored choice
     * anywhere, and `listPersonas` orders by name, so this is the coach the
     * Coach tab opens with rather than an arbitrary one.
     */
    const voiced = personas.find((p) => p.voiced) ?? null;

    if (!speak) {
      return { asked, reply, audio: null, silent: 'not-asked', coach: null, error: null };
    }
    if (voiced === null) {
      return { asked, reply, audio: null, silent: 'no-voice', coach: null, error: null };
    }

    /*
     * INVARIANT: only a reply within the speech stage's own bound is spoken —
     *            ADR 0031 §4. `SPEECH_ASSUMED_COST_USD` is calibrated on
     *            `MAX_TRANSCRIPT_CHARS`, and the budget gate charges that flat
     *            figure per unpriced speech row — so speaking something longer
     *            would not cost more in the ledger while costing more in fact.
     *
     * Checked HERE rather than caught from `speechScript`'s RangeError: a
     * refusal the card can explain is not an exception, and the user is told
     * their answer was too long to read aloud rather than shown a failure.
     */
    if (reply.length > MAX_TRANSCRIPT_CHARS) {
      return { asked, reply, audio: null, silent: 'too-long', coach: voiced.name, error: null };
    }

    /*
     * INVARIANT: model-written prose is sanitised before it is performed —
     *            CLAUDE.md #11, and `src/speech/script.ts`'s own AI-NOTE asked
     *            for exactly this in exactly this PR. The first draft passed the
     *            completion straight through, and a review caught it.
     *
     * The user does not choose these words, but they shape them, and the speech
     * model's input IS an instruction channel: square brackets are performance
     * tags and a second `### DIRECTOR'S NOTES` block is a second set of
     * directions. "The chat model probably will not comply" is defence in depth,
     * which ADR 0005 §3 says explicitly is not the control.
     */
    const line = spokenLine(reply);
    if (line === '') {
      // A reply that was nothing but tags sanitises to nothing. `speechScript`
      // throws on an empty transcript, and a refusal must not become a 500.
      return { asked, reply, audio: null, silent: 'failed', coach: voiced.name, error: null };
    }

    const coach = await coachVoice(db, voiced.slug);
    if (!coach) {
      return { asked, reply, audio: null, silent: 'no-voice', coach: null, error: null };
    }

    const clip = await callSpeech(
      {
        userId: user.id,
        // The sanitised REPLY, which this function produced. Never `asked`.
        input: speechScript(coach.direction, line),
        voice: coach.voice,
      },
      createGatewayDeps(createSupabaseLedger(db))
    );

    return {
      asked,
      reply,
      /*
       * The `Uint8Array` as it is — FOUND IN REVIEW, and the first draft's
       * comment claiming it does not survive the boundary was false.
       * `src/speech/player.ts` records the opposite, measured: React serialises
       * one in a server action's result unchanged, which is why `hearCoach`
       * returns it raw. Converting it made a 1.4 MB clip a 1.4-million-element
       * array and a decimal-text payload several times larger, against a ~4.5 MB
       * response ceiling — so a long clip could be generated, charged, and then
       * fail to cross.
       */
      audio: { bytes: clip.audio, contentType: clip.contentType },
      silent: null,
      coach: voiced.name,
      error: null,
    };
  } catch (cause) {
    /*
     * Two errors are the user's business and the rest are not — ADR 0028. The
     * budget one especially: it reports their OWN weekly spend, and on this
     * surface it is the likeliest refusal there is.
     */
    // Control flow, not failure: `redirect` throws by design and must pass.
    unstable_rethrow(cause);

    /*
     * REBUILT from the error's typed fields rather than read off `.message` —
     * ADR 0028, and `userFacingError` exists because a previous review found the
     * guarantee depending on nobody reassigning that property. The first draft
     * hand-rolled the branch and read `.message`; this is the same decision made
     * by the module that owns it.
     */
    const shown = userFacingError(cause, 'The coach could not answer that one.');
    if (isUserFacing(cause)) {
      return {
        asked,
        reply: '',
        audio: null,
        silent: refusalFor(cause),
        coach: null,
        error: shown,
      };
    }

    console.error('session coach failed', logLine(cause));
    return {
      asked,
      reply: '',
      audio: null,
      silent: 'failed',
      coach: null,
      error: shown,
    };
  }
}
