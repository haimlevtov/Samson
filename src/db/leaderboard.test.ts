/**
 * The display-name clamp.
 *
 * WHY this is worth a unit test when the view already decides who appears: this
 * is the one string in the app that ONE user writes and ANOTHER user reads, and
 * every case below is a way to vandalise somebody else's screen rather than
 * your own. The db suite proves who is on the leaderboard; this proves what
 * their name can do once it is there.
 *
 * No database — `clampDisplayName` is pure, and the type-only import of `Db`
 * is erased at runtime.
 */
import { describe, expect, it } from 'vitest';
import { clampDisplayName } from './leaderboard';

/*
 * The hostile characters, built from code points.
 *
 * AI-NOTE: never paste these as literals. A control or zero-width character in
 *          a source file is invisible in every diff that would have to approve
 *          it, and `grep` reports the file as binary and stops printing line
 *          numbers. src/llm/safety.test.ts writes them as `\u` escapes for the
 *          same reason; fromCharCode is the version a copy-paste cannot get
 *          wrong, and it names each one in the code rather than in a comment.
 */
const ch = (code: number): string => String.fromCharCode(code);
const RLO = ch(0x202e); // right-to-left override
const ZWSP = ch(0x200b); // zero-width space
const BOM = ch(0xfeff); // byte-order mark
const SHY = ch(0x00ad); // soft hyphen
const NUL = ch(0x0000); // C0 control

describe('clampDisplayName — characters that attack the reader, not the writer', () => {
  it('strips a bidirectional override', () => {
    // Left in, everything rendered after it on the row reverses — including
    // other people's names, depending on how the browser resolves the run.
    expect(clampDisplayName(`Haim${RLO} reversed`)).toBe('Haim reversed');
  });

  it('strips zero-width characters used to pad a name out of its cell', () => {
    expect(clampDisplayName(`A${ZWSP.repeat(40)}B`)).toBe('AB');
  });

  it('strips the byte-order mark and the soft hyphen', () => {
    expect(clampDisplayName(`${BOM}Ha${SHY}im`)).toBe('Haim');
  });

  it('strips control characters, newlines included', () => {
    // A newline in a table cell is a name that occupies two rows.
    expect(clampDisplayName(`Haim${NUL}\nLev`)).toBe('HaimLev');
  });

  it('trims surrounding whitespace', () => {
    expect(clampDisplayName('   Haim   ')).toBe('Haim');
  });
});

describe('clampDisplayName — ordinary names are left alone', () => {
  it('keeps accents, scripts and punctuation', () => {
    // A guard that mangles real names is one somebody turns off.
    for (const name of ['Zoë', 'Ólafur', 'חיים', '大山', "O'Neill", 'Jean-Luc']) {
      expect(clampDisplayName(name)).toBe(name);
    }
  });

  it('keeps an emoji intact', () => {
    expect(clampDisplayName('Haim 🏋')).toBe('Haim 🏋');
  });
});

describe('clampDisplayName — length', () => {
  it('leaves a name at the limit untouched', () => {
    const exact = 'a'.repeat(60);
    expect(clampDisplayName(exact)).toBe(exact);
  });

  it('truncates a longer one and marks it', () => {
    expect(clampDisplayName('a'.repeat(200))).toBe(`${'a'.repeat(60)}…`);
  });

  it('counts code points, not UTF-16 units', () => {
    /*
     * The bug this prevents: `slice()` on a string of astral characters cuts a
     * surrogate pair in half and renders a replacement glyph. 40 two-unit
     * emoji are 80 UTF-16 units and 40 characters, so nothing should be cut.
     */
    const emoji = '🏋'.repeat(40);
    expect(clampDisplayName(emoji)).toBe(emoji);

    // 70 of them is over the limit, and the cut lands on a character boundary.
    const long = clampDisplayName('🏋'.repeat(70));
    expect([...long]).toHaveLength(61); // 60 emoji plus the ellipsis
    expect(long).not.toContain('�');
  });

  it('measures after stripping, so padding cannot force a truncation', () => {
    // Otherwise a name of 60 real characters plus invisible padding would be
    // truncated to 59 and an ellipsis — the author vandalising themselves, but
    // still a wrong answer.
    expect(clampDisplayName(`${'a'.repeat(60)}${ZWSP.repeat(50)}`)).toBe('a'.repeat(60));
  });
});
