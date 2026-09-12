/**
 * Speaking a reply the app just generated — ADR 0031 §2 and §4, ADR 0025 §4.
 *
 * WHY this is a module rather than a block in each action. The session card had
 * it first; the Coach tab's chat is the second surface to want it, and what
 * would have been copied is the most safety-sensitive stretch of code in the
 * project: the sanitiser that stands between model-written prose and the speech
 * model's instruction channel, the bound that keeps the cost assumption honest,
 * and the refusals a card can explain. `src/speech/script.ts`'s own AI-NOTE
 * says to use `spokenLine` "for anything that is not a shared row's own column",
 * and a second hand-written copy is how that instruction gets missed once.
 *
 * INVARIANT: what is performed is the REPLY this request generated — never the
 *            question. ADR 0025 §4 says the server never speaks text the browser
 *            sent, and ADR 0031 §2 records that phrasing as literally true and
 *            substantively false once a reply answers a user's question: the
 *            user shapes it. That is why it goes through `spokenLine`, and why
 *            this module cannot, on its own, promise more than "not the
 *            question".
 *
 * INVARIANT: the direction and the voice come from a SHARED persona row
 *            (`user_id is null`), so no row a user can write is ever performed.
 *            `coachVoice` enforces it; this module never reaches past it.
 */
import type { Db } from '../db/client';
import { coachVoice, listPersonas } from '../db/personas';
import { openingCoach } from '../persona/choice';
import { callSpeech, createGatewayDeps } from '../llm/gateway';
import { createSupabaseLedger } from '../db/ledger';
import { MAX_TRANSCRIPT_CHARS, speechScript, spokenLine } from './script';
import type { VoiceRefusal } from './player';
import { MissingApiKeyError } from '../llm/config';
import { BudgetExceededError } from '../llm/types';

/**
 * Why a reply arrived without audio. Each surface renders a sentence for every
 * one but `not-asked`, which is not a failure and says nothing.
 *
 * Here because two surfaces return it — the session card and the Coach tab's
 * chat — and `app/history/session-coach.ts` had it first. Moved rather than
 * copied, and re-exported from there.
 */
export type SilentReason =
  | VoiceRefusal
  /** The user did not ask for audio. */
  | 'not-asked'
  /**
   * The reply is longer than the speech stage's bound — ADR 0031 §4. The
   * assumption behind `SPEECH_ASSUMED_COST_USD` is calibrated on that bound, so
   * speaking past it would make the budget gate count the wrong thing.
   */
  | 'too-long';

/** A clip, or the reason there is none, plus who would have said it. */
export interface Performance {
  /*
   * `Uint8Array<ArrayBuffer>`, not the default `ArrayBufferLike` — the type the
   * session card already declared, and what `new Blob([bytes])` in the browser
   * accepts without a copy. (An earlier comment here claimed a
   * `SharedArrayBuffer`-backed view would not cross the action boundary; nothing
   * supports that, and React serialises any `Uint8Array` the same way.)
   */
  audio: { bytes: Uint8Array<ArrayBuffer>; contentType: string } | null;
  /**
   * Never `not-asked`, `no-key` or `budget` from here: the caller knows whether
   * speech was asked for, and the two gateway refusals are thrown for the caller
   * to word (ADR 0028).
   */
  silent: Exclude<SilentReason, 'not-asked' | 'no-key' | 'budget'> | null;
  /** The coach's name, for the card to attribute the voice. Null when unknown. */
  coach: string | null;
}

/**
 * Speaks `reply` in the user's chosen coach's voice, or says why it could not.
 *
 * THE COACH IS THE ONE THE USER PICKED — `users.persona_slug`, which rework PR 8
 * added for exactly this. ADR 0031 §5 settled for "the first shared, voiced
 * coach alphabetically" because the column did not exist; that is the fallback
 * now, for somebody who has not chosen.
 *
 * Eligibility is decided HERE rather than inside `openingCoach`: only a shared,
 * voiced coach can be performed, so the stored slug is resolved against that
 * subset. A user whose coach has no voice gets the voiced default rather than
 * silence — the same thing every user got before the column existed.
 *
 * THROWS rather than returning 'failed' for a gateway refusal. The caller maps
 * `MissingApiKeyError` and `BudgetExceededError` to their own sentences — those
 * two are the user's business (ADR 0028) and the surfaces word them differently.
 */
export async function performReply(
  db: Db,
  input: {
    userId: string;
    reply: string;
    personaSlug: string | null;
    /**
     * The speech call's own bounds, when the caller is inside a function with a
     * ceiling. Absent, the gateway's defaults apply — up to two attempts at 20s
     * each, which is 40.5s of speech alone and does not fit after a chat call on
     * a 60-second route. See `speechWindow`.
     */
    bounds?: { maxAttempts: number; timeoutMs: number };
  }
): Promise<Performance> {
  const personas = await listPersonas(db);
  const voicedSlugs = personas.filter((persona) => persona.voiced).map((persona) => persona.slug);
  const speaking = openingCoach(voicedSlugs, input.personaSlug);
  const voiced = personas.find((persona) => persona.voiced && persona.slug === speaking) ?? null;

  if (voiced === null) return { audio: null, silent: 'no-voice', coach: null };

  /*
   * INVARIANT: only a reply within the speech stage's own bound is spoken —
   *            ADR 0031 §4. `SPEECH_ASSUMED_COST_USD` is calibrated on
   *            `MAX_TRANSCRIPT_CHARS`, and the budget gate charges that flat
   *            figure per unpriced speech row — so speaking something longer
   *            would not cost more in the ledger while costing more in fact.
   *
   * Checked here rather than caught from `speechScript`'s RangeError: a refusal
   * the card can explain is not an exception.
   */
  if (input.reply.length > MAX_TRANSCRIPT_CHARS) {
    return { audio: null, silent: 'too-long', coach: voiced.name };
  }

  /*
   * INVARIANT: model-written prose is sanitised before it is performed —
   *            CLAUDE.md #11. The user does not choose these words, but they
   *            shape them, and the speech model's input IS an instruction
   *            channel: square brackets are performance tags and a second
   *            director's-notes block is a second set of directions. "The chat
   *            model probably will not comply" is defence in depth, which ADR
   *            0005 §3 says explicitly is not the control.
   */
  const line = spokenLine(input.reply);
  if (line === '') {
    // A reply that was nothing but tags sanitises to nothing. `speechScript`
    // throws on an empty transcript, and a refusal must not become a 500.
    return { audio: null, silent: 'failed', coach: voiced.name };
  }

  const coach = await coachVoice(db, voiced.slug);
  if (!coach) return { audio: null, silent: 'no-voice', coach: null };

  const clip = await callSpeech(
    {
      userId: input.userId,
      // The sanitised REPLY, which the caller generated. Never the question.
      input: speechScript(coach.direction, line),
      voice: coach.voice,
      ...input.bounds,
    },
    createGatewayDeps(createSupabaseLedger(db))
  );

  /*
   * The `Uint8Array` as it is. React serialises one in a server action's result
   * unchanged — measured, and recorded in `src/speech/player.ts`. Converting it
   * made a 1.4 MB clip a 1.4-million-element array and a decimal-text payload
   * several times larger, against a ~4.5 MB response ceiling, so a long clip
   * could be generated, charged, and then fail to cross.
   */
  return {
    audio: { bytes: clip.audio, contentType: clip.contentType },
    silent: null,
    coach: voiced.name,
  };
}

/** What a surface stores about the newest reply's voice. */
export interface SpokenReply {
  audio: Performance['audio'];
  silent: SilentReason | null;
  coach: string | null;
}

/**
 * Speaks a reply when asked, and ALWAYS resolves — rework PR 6.
 *
 * INVARIANT: a failure to SPEAK never costs the user the WRITTEN answer. This
 *            runs after the chat call has succeeded and the answer exists. If it
 *            rejected, the action's outer catch would replace a reply the user
 *            can read with an error they cannot act on — so every failure here
 *            becomes a silent reason the card has a sentence for, and the reply
 *            is kept.
 *
 * The two gateway refusals are the user's business and are named (ADR 0028):
 * no key, and the week's budget spent — which on the chattier surface is the
 * likeliest refusal there is. Everything else is `failed`, handed to `onFailure`
 * so the caller can log a name and a bounded message rather than the object.
 *
 * WHY here rather than in the action: nothing under `app/` is in the unit suite,
 * and this is the one decision on the Coach tab's voice path that has to be held
 * by a test. `perform` is injected so the test does not need a database or a key.
 */
export async function speakIfAsked(
  input: { wanted: boolean; reply: string | null },
  perform: (reply: string) => Promise<Performance>,
  onFailure: (cause: unknown) => void = () => {}
): Promise<SpokenReply> {
  if (!input.wanted) return { audio: null, silent: 'not-asked', coach: null };

  // Nothing written to speak: the supplement route answers with a row, and
  // reading out the constant naming what happened would put the app's words in
  // a coach's voice.
  if (input.reply === null) return { audio: null, silent: null, coach: null };

  try {
    return await perform(input.reply);
  } catch (cause) {
    if (cause instanceof MissingApiKeyError) return { audio: null, silent: 'no-key', coach: null };
    if (cause instanceof BudgetExceededError) return { audio: null, silent: 'budget', coach: null };
    /*
     * Guarded, because it is the caller's code running inside the one catch that
     * exists to make this function total. FOUND IN REVIEW: `logLine` reads
     * `cause.message`, and an Error whose message is not a string makes it
     * throw — which would have turned "always resolves" into a rejection from
     * the logging line of the error path.
     */
    try {
      onFailure(cause);
    } catch {
      // Nothing to do: the reply is kept either way, which is the point.
    }
    return { audio: null, silent: 'failed', coach: null };
  }
}

/**
 * How long a speech call may take, given how long the request has already run —
 * or null when there is too little left to start a paid call at all.
 *
 * FOUND IN REVIEW of rework PR 6. The Coach tab's route caps its functions at 60
 * seconds, the chat call runs first, and `callSpeech` retries a timeout by
 * default: two 20-second attempts and a backoff is 40.5 seconds of speech on its
 * own. A slow chat followed by one timed-out attempt got the function KILLED
 * mid-retry — so `speakIfAsked`'s catch never ran, the failure reached the error
 * boundary, and the page was replaced with the transcript lost. The written
 * answer the whole speech path is built to protect was lost to the likeliest
 * speech failure there is.
 *
 * So speech gets ONE attempt, sized to what is left before a deadline that sits
 * inside the function's ceiling — the gap `WEB_PLAN_DEADLINE_MS` keeps for the
 * same reason on the same route. Below `minMs` it does not start: a call that
 * cannot finish is a charge for nothing, and a refusal the card can explain is
 * better than a page that dies.
 */
export function speechWindow(input: {
  elapsedMs: number;
  deadlineMs: number;
  minMs: number;
  maxMs: number;
}): { maxAttempts: number; timeoutMs: number } | null {
  const left = input.deadlineMs - input.elapsedMs;
  if (left < input.minMs) return null;
  return { maxAttempts: 1, timeoutMs: Math.min(input.maxMs, left) };
}
