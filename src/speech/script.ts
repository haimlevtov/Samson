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
 * INVARIANT: known text only — ADR 0025 §4. Both halves come from a shared
 *            persona row (`coachVoice` in src/db/personas.ts); nothing here
 *            takes what the browser sent.
 *
 * AI-NOTE: this format belongs to the model in STAGE_MODELS.speech. A model
 *          with a separate instructions field would take the notes there, and
 *          a different model has different voices — changing the model means
 *          changing this file and recasting every persona row.
 * AI-NOTE: square brackets in a transcript are audio tags to this model —
 *          "[whispers]" is performed, not said. Shipped lines have none
 *          (tests/db/personas.test.ts). The later PR that speaks model-written
 *          prose — a delivered plan, shaped by the user's own notes — makes the
 *          transcript untrusted (CLAUDE.md #11) and must strip the brackets AND
 *          this file's own label text (`### DIRECTOR'S NOTES`, `### TRANSCRIPT`)
 *          first, and stop logging upstream error bodies, which can echo the
 *          input back. Found in the security review of #49.
 */

/**
 * The model's thirty voices, with Google's one word for each.
 *
 * Checked against the provider's model list on 2026-09-11. Every shipped
 * coach's `tts_voice` must be a key here, and no two may share one —
 * tests/db/personas.test.ts. The words are what the coaches were cast by.
 */
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
