/**
 * Tests for `src/ui/speak.ts`.
 *
 * The regression these exist for: voices were chosen by language alone, so the
 * two personas sharing `en-GB` resolved to the same voice object, and on a
 * device with no en-GB voice installed the `en-US` persona fell back to that
 * same voice as well. All three coaches spoke identically under a control
 * labelled "Voice", and nothing in the suite noticed because this module had no
 * tests.
 *
 * Only the pure functions are covered. `speak()` itself needs a real
 * `window.speechSynthesis`, which the node test environment does not have — and
 * mocking the whole speech stack would assert the shape of the mock rather than
 * anything about the browser.
 */
import { describe, expect, it } from 'vitest';
import { pickVoice, spokenIntensity, voiceSettings, type VoiceLike } from './speak';
import { GENTLE_MAX_INTENSITY, resolveTone } from '../persona/tone';
import type { Persona } from '../persona/schema';

const voice = (name: string, lang: string): VoiceLike => ({ name, lang });

/** A typical Windows machine: US English only, no en-GB installed. */
const US_ONLY = [
  voice('Microsoft David - English (United States)', 'en-US'),
  voice('Microsoft Mark - English (United States)', 'en-US'),
  voice('Microsoft Zira - English (United States)', 'en-US'),
];

/** A machine with both, plus an unrelated language to be ignored. */
const MIXED = [
  voice('Google UK English Female', 'en-GB'),
  voice('Google UK English Male', 'en-GB'),
  voice('Microsoft David - English (United States)', 'en-US'),
  voice('Google Deutsch', 'de-DE'),
];

describe('pickVoice', () => {
  it('prefers an exact language match over a prefix one', () => {
    const picked = pickVoice(MIXED, 'en-GB');
    expect(picked?.lang).toBe('en-GB');
  });

  it('falls back to the language prefix rather than falling silent', () => {
    // Asking for en-GB on a US-only machine should speak American English, not
    // nothing. This fallback is correct, and is also what used to collapse
    // every persona onto one voice.
    expect(pickVoice(US_ONLY, 'en-GB')?.lang).toBe('en-US');
  });

  it('never crosses into an unrelated language', () => {
    expect(pickVoice([voice('Google Deutsch', 'de-DE')], 'en-GB')).toBeNull();
  });

  it('treats an underscore locale as equivalent', () => {
    expect(pickVoice([voice('Some Voice', 'en_GB')], 'en-GB')?.name).toBe('Some Voice');
  });

  /*
   * The regression itself. These are the three shipped personas as seeded:
   * analyst en-US, old-master en-GB, rival en-GB — two sharing a language — on
   * a machine that has no en-GB voice at all, so every one of them resolves
   * through the prefix fallback into the same pool.
   */
  it('gives three personas three different voices on a single-language device', () => {
    const picked = [
      pickVoice(US_ONLY, 'en-US', 0),
      pickVoice(US_ONLY, 'en-GB', 1),
      pickVoice(US_ONLY, 'en-GB', 2),
    ];

    expect(picked.every((v) => v !== null)).toBe(true);
    expect(new Set(picked.map((v) => v!.name)).size, 'three coaches, three voices').toBe(3);
  });

  it('keeps two personas apart even when they share a language exactly', () => {
    const first = pickVoice(MIXED, 'en-GB', 1);
    const second = pickVoice(MIXED, 'en-GB', 2);

    expect(first?.lang).toBe('en-GB');
    expect(second?.lang).toBe('en-GB');
    expect(first?.name).not.toBe(second?.name);
  });

  it('is stable: the same variant always lands on the same voice', () => {
    expect(pickVoice(MIXED, 'en-GB', 1)?.name).toBe(pickVoice(MIXED, 'en-GB', 1)?.name);
  });

  it('does not depend on the order getVoices happened to return', () => {
    // getVoices() order is unspecified and differs between engines, so without
    // a stable sort a persona would change voice depending on which loaded
    // first.
    const shuffled = [...MIXED].reverse();
    expect(pickVoice(shuffled, 'en-GB', 1)?.name).toBe(pickVoice(MIXED, 'en-GB', 1)?.name);
  });

  it('wraps rather than falling off the end of a short list', () => {
    const single = [voice('Only One', 'en-GB')];
    expect(pickVoice(single, 'en-GB', 7)?.name).toBe('Only One');
  });

  it('returns null when there is nothing to choose from', () => {
    expect(pickVoice([], 'en-GB')).toBeNull();
    // No hint means no persona, so the system default is the right answer.
    expect(pickVoice(MIXED, null)).toBeNull();
  });
});

describe('voiceSettings', () => {
  it('maps the shipped intensities to the documented rate and pitch', () => {
    // toBeCloseTo, not toEqual: 0.9 + 0.05 is 0.9500000000000001 in binary
    // floating point, and pinning the artefact would be pinning the wrong thing.
    const cases: [number, number, number][] = [
      [2, 0.975, 0.95],
      [3, 1.05, 1.0],
      [4, 1.125, 1.05],
    ];

    for (const [intensity, rate, pitch] of cases) {
      expect(voiceSettings(intensity).rate, `rate at ${intensity}`).toBeCloseTo(rate, 10);
      expect(voiceSettings(intensity).pitch, `pitch at ${intensity}`).toBeCloseTo(pitch, 10);
    }
  });

  it('clamps out-of-range intensities rather than producing an unusable rate', () => {
    expect(voiceSettings(0)).toEqual(voiceSettings(1));
    expect(voiceSettings(99)).toEqual(voiceSettings(5));
  });

  it('is too narrow to identify a speaker on its own', () => {
    // One step is a 7% rate change. Documenting the reason `variant` exists.
    const { rate: a } = voiceSettings(3);
    const { rate: b } = voiceSettings(4);
    expect(Math.abs(b - a) / a).toBeLessThan(0.1);
  });
});

describe('spokenIntensity', () => {
  it('softens the speech on a week the app has judged gentle', () => {
    // The banner says "not a week to push"; speaking it faster and higher than
    // usual contradicted the words it was reading.
    expect(spokenIntensity(4, true)).toBe(GENTLE_MAX_INTENSITY);
    expect(voiceSettings(spokenIntensity(4, true)).rate).toBeLessThan(voiceSettings(4).rate);
  });

  it('leaves an ordinary week alone', () => {
    expect(spokenIntensity(4, false)).toBe(4);
  });

  it('leaves a persona already at or below the gentle ceiling where it is', () => {
    // This is the case the previous implementation got wrong. Subtracting two
    // instead of clamping to two took the Analyst at 2 down to 1, so the words
    // were written at 2 and read aloud at 1.
    expect(spokenIntensity(2, true)).toBe(2);
    expect(spokenIntensity(1, true)).toBe(1);
  });

  /*
   * The property that matters, rather than three examples of it: the voice and
   * the words must be softened by the SAME rule. `resolveTone` decides the
   * intensity the persona writes at; `spokenIntensity` decides the intensity it
   * is read at. Two definitions of "gentle" is one too many, and the drift is
   * invisible — nothing crashes, the coach just sounds unlike its own text.
   */
  it('agrees with resolveTone at every point on the scale', () => {
    const persona = (intensity: number): Persona => ({
      slug: 'fixture',
      name: 'Fixture',
      systemPrompt: 'x',
      intensity,
      humorLevel: 'clean',
      bannedPhrases: [],
      voiceVariant: 0,
    });

    for (const intensity of [1, 2, 3, 4, 5]) {
      for (const gentle of [true, false]) {
        const tone = resolveTone(
          persona(intensity),
          'clean',
          gentle
            ? { notes: ['tweaked my knee'], adherenceRate: 1 }
            : { notes: [], adherenceRate: 1 }
        );

        expect(tone.gentle, `gentle flag for intensity ${intensity}`).toBe(gentle);
        expect(spokenIntensity(intensity, gentle), `intensity ${intensity}, gentle ${gentle}`).toBe(
          tone.intensity
        );
      }
    }
  });
});
