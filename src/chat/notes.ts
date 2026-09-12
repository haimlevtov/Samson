/**
 * What the coach is allowed to remember — ADR 0030.
 *
 * The checks only, as pure functions, so the whole rule runs in the unit suite
 * with no key, no network and no database. The queries are `src/db/notes.ts` and
 * the write is `app/coach/actions.ts`.
 *
 * INVARIANT: the model PROPOSES and this file DISPOSES — ADR 0030 §1. Nothing
 *            the model emits reaches the table; what reaches the table is what
 *            `acceptableNote` returned.
 */
import { stripInvisible } from '../llm/safety';

/**
 * A sentence, not a paragraph.
 *
 * WHY its own constant rather than `MAX_FIELD_CHARS`, which is also 120: that
 * one is sized for an exercise name, and coupling them would mean a change to
 * how long a lift may be called silently changes what a memory is. The same
 * mistake `MAX_CLAIM_CHARS` exists to correct, one table along.
 */
export const MAX_NOTE_CHARS = 120;

/** At most this many are kept, newest first — ADR 0030 §3. */
export const MAX_NOTES = 20;

/**
 * Any digit, in any script.
 *
 * INVARIANT: a note states no NUMERAL — ADR 0030 §2, CLAUDE.md #1. A remembered
 *            number is one the metrics engine did not produce, and it would be
 *            re-fed to the model every turn as though it had: "squats 100 kg"
 *            outlives the session it was invented in, and every later reply
 *            reads it as established.
 *
 * The same predicate and the same reasoning as the diet route's — see
 * `ANY_DIGIT` in `./reply.ts`, which carries the review that found why `\d` is
 * not enough. `\p{N}` covers Nd, Nl and No, so Arabic-Indic, Devanagari,
 * fullwidth and superscript digits are all one test.
 */
const ANY_DIGIT = /\p{N}/u;

/** Number words, and the units that make one a claim about training. */
const NUMBER_WORD =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|dozen|half|quarter';
const TRAINING_UNIT =
  'kgs?|kilos?|kilograms?|lbs?|pounds?|reps?|sets?|kcals?|cals?|calorie|calories';

/**
 * A figure written out in words, with a unit on it.
 *
 * FOUND IN REVIEW, and it falsified this file's own headline: "no numeral" is
 * not "no figure". `acceptableNote('user squats two hundred kilos', [])` passed
 * every check, and a note is re-fed on every later turn — so the model could
 * then say "given your two hundred kilo squat" and no guard would fire, because
 * `findUnknownNumbers` and the diet route's check both read NUMERALS. The
 * pre-existing version of that hole lasts one turn; a note makes it survive a
 * cleared transcript and a new device.
 *
 * INVARIANT: the UNIT is the boundary, exactly as it is in `CALORIE_FIGURE` —
 *            see `./reply.ts`. A bare spelled number is not matched and is not
 *            meant to be: "wants one more session a week" is a memory worth
 *            keeping, and a guard that refused it would be refusing ordinary
 *            language to catch a case the model has no reason to write.
 *
 * AI-NOTE: English only, and that is a real limit rather than an oversight — the
 *          alternative is a number-word list per language, which is the shape
 *          `scanOutput` declines for slurs and for the same reason. State it in
 *          a report; do not describe this as closing the spelled-figure hole.
 *          The units are deliberately the METRICS ones — load, volume, energy.
 *          Days and weeks are absent so that a scheduling preference stays
 *          rememberable.
 */
const SPELLED_FIGURE = new RegExp(
  `\\b(?:${NUMBER_WORD})(?:[\\s-]+(?:and|${NUMBER_WORD}))*[\\s-]+(?:${TRAINING_UNIT})\\b`,
  'iu'
);

/**
 * Collapsed, stripped and lowercased, so "Sore  Shoulder" and "sore shoulder"
 * are one note.
 *
 * `stripInvisible` is why this is not just `trim()` — FOUND IN REVIEW. A
 * zero-width space is not whitespace to `String.trim` or to `\s`, so the same
 * sentence with a \u200B on the end passed the duplicate check every turn.
 * Twenty of those evict twenty real memories, and because `sanitizeUntrusted`
 * strips the invisibles again on the way into the prompt, the model then sees
 * twenty byte-identical lines — the exact outcome ADR 0030 §3 says this rule
 * prevents, reached through the rule.
 */
function comparable(note: string): string {
  return stripInvisible(note).replace(/\s+/gu, ' ').trim().toLowerCase();
}

/**
 * The proposed note, or null if it is not one.
 *
 * WHY null rather than a thrown error or a retry: a bad note must not cost the
 * user their answer. The reply is what they asked for; the note is a side
 * effect, and ADR 0030 §2 says a failed one is dropped and the reply returned as
 * normal. _That is true of every check here. It is NOT true of the gateway's
 * output scan, which runs first and fails the whole call — see the ADR._
 *
 * WHY `existing` is a parameter rather than a query here: this file has no I/O,
 * and the duplicate rule needs the notes that were already loaded for the
 * prompt. The caller has them.
 *
 * `scanOutput` is deliberately NOT applied. The gateway scans every string leaf
 * of the parsed completion — ADR 0005's 2026-09-12 amendment — so an unsafe note
 * has already failed the whole call before this runs. A second scan here would
 * look like a second control and would not be one.
 */
export function acceptableNote(proposed: string, existing: readonly string[]): string | null {
  // Stripped BEFORE anything is measured or compared — see `comparable`. A note
  // carrying a bidi override would also render in the Settings list as text
  // other than what the model is fed, which would make the deletion control
  // ADR 0030 §4 rests on a lie.
  const note = stripInvisible(proposed).trim();

  if (note === '') return null;
  if (note.length > MAX_NOTE_CHARS) return null;
  if (ANY_DIGIT.test(note)) return null;
  if (SPELLED_FIGURE.test(note)) return null;

  // A model asked what to remember will propose the same thing every turn. Left
  // alone, twenty slots become one fact twenty times and the oldest real memory
  // falls off to make room for a copy of the newest.
  const seen = new Set(existing.map(comparable));
  if (seen.has(comparable(note))) return null;

  return note;
}
