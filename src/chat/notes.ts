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
 * INVARIANT: a note states no figure — ADR 0030 §2, CLAUDE.md #1. A remembered
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

/** Collapsed and lowercased, so "Sore  Shoulder" and "sore shoulder" are one. */
function comparable(note: string): string {
  return note.trim().replace(/\s+/gu, ' ').toLowerCase();
}

/**
 * The proposed note, or null if it is not one.
 *
 * WHY null rather than a thrown error or a retry: a bad note must not cost the
 * user their answer. The reply is what they asked for; the note is a side
 * effect, and ADR 0030 §2 says a failed one is dropped and the reply returned as
 * normal.
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
  const note = proposed.trim();

  if (note === '') return null;
  if (note.length > MAX_NOTE_CHARS) return null;
  if (ANY_DIGIT.test(note)) return null;

  // A model asked what to remember will propose the same thing every turn. Left
  // alone, twenty slots become one fact twenty times and the oldest real memory
  // falls off to make room for a copy of the newest.
  const seen = new Set(existing.map(comparable));
  if (seen.has(comparable(note))) return null;

  return note;
}
