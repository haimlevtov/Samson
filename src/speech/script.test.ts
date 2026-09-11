/**
 * Tests for `src/speech/script.ts` — what a coach's voice is given to perform.
 */
import { describe, expect, it } from 'vitest';
import { SPEECH_MAX_INPUT_CHARS } from '../llm/config';
import {
  MAX_DIRECTION_CHARS,
  MAX_TRANSCRIPT_CHARS,
  SPEECH_PREAMBLE,
  SPEECH_VOICES,
  isSpeechVoice,
  speechScript,
} from './script';

const DIRECTION = 'An old sword master: deep, grave, unhurried.';
const LINE = 'Turn up on the Tuesday.';

describe('speechScript', () => {
  it('opens with the fixed preamble and ends with the line, under its label', () => {
    // Static first, dynamic last — and the line LAST, so nothing after it can
    // be mistaken for more transcript.
    const script = speechScript(DIRECTION, LINE);
    expect(script.startsWith(SPEECH_PREAMBLE)).toBe(true);
    expect(script.endsWith(`### TRANSCRIPT\n${LINE}`)).toBe(true);
  });

  it('puts the direction under the notes label, before the transcript', () => {
    // Google's guide: a direction the model cannot tell from the transcript is
    // a direction it may read aloud.
    const script = speechScript(DIRECTION, LINE);
    const notes = script.indexOf(`### DIRECTOR'S NOTES\n${DIRECTION}`);
    const transcript = script.indexOf('### TRANSCRIPT');
    expect(notes).toBeGreaterThan(0);
    expect(transcript).toBeGreaterThan(notes);
  });

  it('names both labels in the preamble, so the model knows which one it performs', () => {
    expect(SPEECH_PREAMBLE).toContain('TRANSCRIPT');
    expect(SPEECH_PREAMBLE).toContain("DIRECTOR'S NOTES");
  });

  it('trims both halves', () => {
    expect(speechScript(`  ${DIRECTION}\n`, `\n${LINE}  `)).toBe(speechScript(DIRECTION, LINE));
  });

  it('refuses a coach with no direction rather than speaking it in an unbriefed voice', () => {
    expect(() => speechScript('   ', LINE)).toThrow(RangeError);
  });

  it('refuses an empty line', () => {
    expect(() => speechScript(DIRECTION, '  ')).toThrow(RangeError);
  });

  it('refuses either half past its column limit', () => {
    expect(() => speechScript('x'.repeat(MAX_DIRECTION_CHARS + 1), LINE)).toThrow(RangeError);
    expect(() => speechScript(DIRECTION, 'x'.repeat(MAX_TRANSCRIPT_CHARS + 1))).toThrow(RangeError);
  });

  it('fits the longest script the columns allow inside the gateway ceiling', () => {
    /*
     * The two limits here are the columns' own, and the gateway refuses
     * anything longer than SPEECH_MAX_INPUT_CHARS. If they drift apart, a
     * shipped coach with a long direction fails on every press — this is where
     * that shows, rather than in a user's Voice card.
     */
    const longest = speechScript('x'.repeat(MAX_DIRECTION_CHARS), 'y'.repeat(MAX_TRANSCRIPT_CHARS));
    expect(longest.length).toBeLessThanOrEqual(SPEECH_MAX_INPUT_CHARS);
  });
});

describe('SPEECH_VOICES', () => {
  it('lists the thirty voices the model offers, each with its word', () => {
    expect(Object.keys(SPEECH_VOICES)).toHaveLength(30);
    for (const [name, word] of Object.entries(SPEECH_VOICES)) {
      expect(word, name).not.toBe('');
    }
  });

  it('answers by exact name, as the model matches it', () => {
    expect(isSpeechVoice('Algenib')).toBe(true);
    expect(isSpeechVoice('algenib')).toBe(false);
    // An inherited property is not a voice.
    expect(isSpeechVoice('toString')).toBe(false);
  });
});
