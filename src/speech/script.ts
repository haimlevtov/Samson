/**
 * What a coach's voice is given to perform — ADR 0025.
 *
 * The speech model reads its direction from the input itself, so the input is
 * a small script: a fixed preamble, the row's director's notes, and the line
 * under a label. Google's guide for this model warns that a vague prompt can
 * make it read the direction ALOUD, and says to open by telling it to
 * synthesise speech and to mark where the transcript begins — which is what the
 * preamble and the two labels are for.
 *
 * INVARIANT: static first, dynamic last — the order CLAUDE.md #11 keeps for
 *            every stage. The preamble is a constant.
 * INVARIANT: the DIRECTION is known text — ADR 0025 §4. It comes from a shared
 *            persona row (`coachVoice` in src/db/personas.ts) and nothing a user
 *            can write reaches it.
 * INVARIANT: the TRANSCRIPT is no longer known text, as of ADR 0031. A coach's
 *            sample line still comes from a shared row, but a mid-session reply
 *            is model-written prose answering a question the user spoke — so
 *            everything that reaches the transcript through that path goes
 *            through `spokenLine` first. Calling `speechScript` with raw model
 *            output is the bug the AI-NOTE below was written to prevent, and it
 *            was made once already.
 *
 * AI-NOTE: this format belongs to the model in STAGE_MODELS.speech. A model
 *          with a separate instructions field would take the notes there, and
 *          a different model has different voices — changing the model means
 *          changing this file and recasting every persona row.
 * AI-NOTE: square brackets in a transcript are audio tags to this model —
 *          "[whispers]" is performed, not said. Shipped lines have none
 *          (tests/db/personas.test.ts). This note used to say that the later PR
 *          speaking model-written prose "must strip the brackets AND this file's
 *          own label text first" — found in the security review of #49. ADR 0031
 *          is that PR, it shipped the first draft WITHOUT doing any of it, and a
 *          review caught it. `spokenLine` below is the answer; use it for
 *          anything that is not a shared row's own column.
 */

/**
 * The model's thirty voices, with Google's one word for each.
 *
 * Checked against the provider's model list on 2026-09-11. Every shipped
 * coach's `tts_voice` must be a key here, and no two may share one —
 * tests/db/personas.test.ts. The words are what the coaches were cast by.
 */
import { MAX_UNTRUSTED_CHARS, sanitizeUntrusted } from '../llm/safety';

export const SPEECH_VOICES: Readonly<Record<string, string>> = {
  Zephyr: 'bright',
  Puck: 'upbeat',
  Charon: 'informative',
  Kore: 'firm',
  Fenrir: 'excitable',
  Leda: 'youthful',
  Orus: 'firm',
  Aoede: 'breezy',
  Callirrhoe: 'easy-going',
  Autonoe: 'bright',
  Enceladus: 'breathy',
  Iapetus: 'clear',
  Umbriel: 'easy-going',
  Algieba: 'smooth',
  Despina: 'smooth',
  Erinome: 'clear',
  Algenib: 'gravelly',
  Rasalgethi: 'informative',
  Laomedeia: 'upbeat',
  Achernar: 'soft',
  Alnilam: 'firm',
  Schedar: 'even',
  Gacrux: 'mature',
  Pulcherrima: 'forward',
  Achird: 'friendly',
  Zubenelgenubi: 'casual',
  Vindemiatrix: 'gentle',
  Sadachbia: 'lively',
  Sadaltager: 'knowledgeable',
  Sulafat: 'warm',
};

/** Whether the speech model has a voice by this name. */
export function isSpeechVoice(name: string): boolean {
  return Object.hasOwn(SPEECH_VOICES, name);
}

/**
 * Tells the model what to perform and what only to read.
 *
 * WHY it names both labels: the failure Google warns about is the direction
 * being spoken, and a coach reading out "deep, grave, unhurried" before its
 * line is the mismatched voice ADR 0025 exists to end, in a new form.
 */
export const SPEECH_PREAMBLE =
  "Synthesise speech for the text under TRANSCRIPT, and only that text. The DIRECTOR'S NOTES describe the speaker and how the line is performed. Never speak the notes or the labels aloud.";

/** The longest line spoken — the `sample_line` column's own limit. */
export const MAX_TRANSCRIPT_CHARS = 280;

/** The longest direction — the `tts_instructions` column's own limit. */
export const MAX_DIRECTION_CHARS = 600;

/**
 * The input for one spoken line, or a thrown RangeError when either half is
 * empty or longer than its column allows.
 *
 * WHY an empty direction is refused rather than spoken plainly: a coach with a
 * voice and no direction is a voice nobody briefed — the gravelly one reading
 * the Physio's line. A voice that does not fit is worse than none (ADR 0025).
 */
/**
 * Makes model-written prose safe to hand to the speech model — ADR 0031 §2.
 *
 * FOUND IN REVIEW, and the note above had already asked for it. Until this
 * existed, `askDuringSession` passed a chat completion straight to
 * `speechScript`, and that completion answers a question the user spoke. The
 * user does not choose the words — but they shape them, and "shaped by the
 * browser" is what CLAUDE.md #11 is about. The chat model declining to comply is
 * defence in depth, which ADR 0005 §3 says explicitly is not the control.
 *
 * Three things are removed, and each is a different attack:
 *
 * - **Square brackets.** Audio tags to this model: "[whispers]" is PERFORMED
 *   rather than said. They are also a duration attack — "[long pause]" makes a
 *   280-character line minutes long, and `SPEECH_ASSUMED_COST_USD` is calibrated
 *   on thirty seconds and charged flat, so the budget would count the wrong
 *   thing.
 * - **This file's own labels, and any heading.** A second `### DIRECTOR'S NOTES`
 *   block inside the transcript is a second set of instructions in the region
 *   the preamble tells the model to perform from — the speech stage's version of
 *   closing a fence early.
 * - **Whatever `sanitizeUntrusted` removes**, which is the same treatment every
 *   other untrusted string in this project gets.
 *
 * INVARIANT: this returns a line to SPEAK, never a line to show. The user reads
 *            the model's reply as written; only what is performed is stripped.
 *
 * AI-NOTE: an empty result is a real outcome — a reply that was nothing but tags
 *          sanitises to nothing — and the caller must treat it as "do not
 *          speak", not pass it on. `speechScript` throws on an empty transcript,
 *          which would turn a refusal into a 500.
 */
export function spokenLine(text: string): string {
  const stripped = text
    // The whole bracketed SPAN, not just the brackets — FOUND BY TEST. Removing
    // only the delimiters left "whispers" in the line, which the model then
    // reads out: better than performing it, and still not the coach's words.
    .replace(/\[[^\]]*\]?/gu, ' ')
    // Any stray closing bracket the pass above could not pair.
    .replace(/[[\]]/gu, ' ')
    // Any markdown-style heading line, which is what this script's labels are.
    .replace(/^[ \t]*#{1,6}.*$/gmu, ' ')
    // And the label text itself, wherever it appears, with or without a hash.
    .replace(/director'?s notes|transcript/giu, ' ')
    .replace(/\s+/gu, ' ');

  /*
   * Sanitised with a generous cap and then LENGTH-CHECKED, rather than capped at
   * the bound — FOUND BY TEST, and the reason is a good one:
   * `sanitizeUntrusted`'s truncation marker is "… [truncated at N characters]",
   * which puts square brackets back into a string this function exists to take
   * them out of, and pushes the result past the bound it was capping to.
   *
   * Too long is therefore "do not speak", not "speak the first 280 characters".
   * ADR 0031 §4 already refuses to truncate a reply to fit a budget; truncating
   * one here would be the same trade made quietly.
   */
  const clean = sanitizeUntrusted(stripped, MAX_UNTRUSTED_CHARS);
  return clean.length > MAX_TRANSCRIPT_CHARS ? '' : clean;
}

export function speechScript(direction: string, transcript: string): string {
  const notes = direction.trim();
  const line = transcript.trim();

  if (notes === '') throw new RangeError('a coach with no direction is not spoken');
  if (line === '') throw new RangeError('there is no line to speak');
  if (notes.length > MAX_DIRECTION_CHARS) {
    throw new RangeError(
      `the direction is ${notes.length} characters; the most is ${MAX_DIRECTION_CHARS}`
    );
  }
  if (line.length > MAX_TRANSCRIPT_CHARS) {
    throw new RangeError(
      `the line is ${line.length} characters; the most is ${MAX_TRANSCRIPT_CHARS}`
    );
  }

  return `${SPEECH_PREAMBLE}\n\n### DIRECTOR'S NOTES\n${notes}\n\n### TRANSCRIPT\n${line}`;
}
