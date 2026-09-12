/**
 * What code refuses to remember — ADR 0030 §2.
 *
 * The model's judgement is what a note SAYS; these are the rules about what a
 * note may BE, and they are the half that is a control rather than a mitigation.
 */
import { describe, expect, it } from 'vitest';
import { MAX_NOTE_CHARS, acceptableNote } from './notes';

describe('acceptableNote', () => {
  it('keeps an ordinary note, trimmed', () => {
    expect(acceptableNote('  wants to bring up their biceps  ', [])).toBe(
      'wants to bring up their biceps'
    );
  });

  it('drops the empty sentinel, which is how the model says nothing', () => {
    // ADR 0030 §1: the empty string rather than null, so there is one way to
    // say nothing instead of two.
    expect(acceptableNote('', [])).toBeNull();
    expect(acceptableNote('   ', [])).toBeNull();
  });

  it('drops a paragraph, and keeps a note exactly at the bound', () => {
    expect(acceptableNote('a'.repeat(MAX_NOTE_CHARS), [])).toHaveLength(MAX_NOTE_CHARS);
    expect(acceptableNote('a'.repeat(MAX_NOTE_CHARS + 1), [])).toBeNull();
  });

  it('measures the bound after trimming, not before', () => {
    const padded = ` ${'a'.repeat(MAX_NOTE_CHARS)} `;
    expect(acceptableNote(padded, [])).toHaveLength(MAX_NOTE_CHARS);
  });

  it('drops a numeral in any script, not just ASCII', () => {
    // INVARIANT: a note states no figure — CLAUDE.md #1. `\d` is ASCII-only
    // even under the `u` flag, which is the hole `ANY_DIGIT` in reply.ts
    // records; the same predicate is used here for the same reason.
    expect(acceptableNote('squats 100 kg', [])).toBeNull();
    expect(acceptableNote('squats ١٠٠ kg', [])).toBeNull();
    expect(acceptableNote('squats १०० kg', [])).toBeNull();
    expect(acceptableNote('squats １００ kg', [])).toBeNull();
    expect(acceptableNote('squats ¹⁰⁰ kg', [])).toBeNull();
  });

  it('keeps a memory that describes rather than measures', () => {
    // The rule costs nothing a coach needs: the things worth remembering are
    // claims about a person, and none of them is a quantity.
    expect(acceptableNote('reported a sore left shoulder', [])).not.toBeNull();
    expect(acceptableNote('wants more work on their back', [])).not.toBeNull();
  });

  it('drops a duplicate, ignoring case and repeated whitespace', () => {
    const held = ['wants to bring up their biceps'];
    expect(acceptableNote('Wants To Bring Up Their Biceps', held)).toBeNull();
    expect(acceptableNote('wants  to   bring up their biceps', held)).toBeNull();
    expect(acceptableNote('  wants to bring up their biceps', held)).toBeNull();
  });

  it('keeps a note that is merely similar, which is the cost of the rule', () => {
    // Stated rather than hidden: the duplicate check is exact after
    // normalising, so a model that rephrases itself still fills slots. It
    // stops the common case — the same sentence every turn — and not the
    // determined one.
    expect(acceptableNote('wants to bring up the biceps', ['wants to bring up their biceps'])).toBe(
      'wants to bring up the biceps'
    );
  });
});
