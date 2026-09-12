/**
 * Speaking a reply the app just generated — ADR 0031 §2 and §4, ADR 0025 §4.
 *
 * WHY this is a module rather than a block in each action. The session card had
 * it first; the Coach tab's chat is the second surface to want it, and what
 * would have been copied is the most safety-sensitive stretch of code in the
 * project: the sanitiser that stands between model-written prose and the speech
 * model's instruction channel, the bound that keeps the cost assumption honest,
 * and the four refusals a card can explain. `src/speech/script.ts`'s own AI-NOTE
 * says to use `spokenLine` "for anything that is not a shared row's own column",
 * and a second hand-written copy is how that instruction gets missed once.
 *
 * INVARIANT: the server never speaks text the browser sent — ADR 0025 §4. What
 *            is performed is the REPLY this request generated, never the
 *            question, and never anything the client supplied.
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

/** Why a reply was shown rather than heard. The card has a sentence for each. */
export type SilentReason = 'no-voice' | 'too-long' | 'failed';

/** A clip, or the reason there is none, plus who would have said it. */
export interface Performance {
  /*
   * `Uint8Array<ArrayBuffer>`, not the default `ArrayBufferLike` — the type the
   * session card already declares. A `SharedArrayBuffer`-backed view does not
   * cross a server-action boundary, and the narrower type is what makes that a
   * compile error rather than a runtime surprise.
   */
  audio: { bytes: Uint8Array<ArrayBuffer>; contentType: string } | null;
  silent: SilentReason | null;
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
  input: { userId: string; reply: string; personaSlug: string | null }
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
