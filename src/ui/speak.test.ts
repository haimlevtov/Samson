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
import {
  GENTLE_RATE_FACTOR,
  personaSpeech,
  pickVoice,
  previewSpeech,
  voiceGender,
  voiceSettings,
  voiceTier,
  type VoiceLike,
} from './speak';

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
   * The regression itself: several coaches, two languages, and a machine that
   * has no en-GB voice at all, so every one of them resolves through the prefix
   * fallback into the same pool.
   *
   * The variants below are the ARGUMENT SHAPE, not the seeded values — this
   * file tests `pickVoice`, which never sees a persona row. The live allocation
   * is en-GB 0/1/2 and en-US 0/1 (migrations 20260901154757 and
   * 20260908110000), maintained in .claude/skills/add-persona/SKILL.md §2 and
   * checked against the rows by tests/db/personas.test.ts.
   *
   * FOUND IN REVIEW: this used to claim these WERE "the three shipped personas
   * as seeded", which was wrong on the count once two more shipped and had
   * never matched the seeded variants anyway.
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

describe('voiceGender', () => {
  it('reads the word Google puts in the name', () => {
    expect(voiceGender(voice('Google UK English Female', 'en-GB'))).toBe('female');
    expect(voiceGender(voice('Google UK English Male', 'en-GB'))).toBe('male');
  });

  it('reads the first name Microsoft puts in the name, desktop and neural alike', () => {
    expect(voiceGender(voice('Microsoft Zira - English (United States)', 'en-US'))).toBe('female');
    expect(voiceGender(voice('Microsoft David - English (United States)', 'en-US'))).toBe('male');
    expect(
      voiceGender(voice('Microsoft Guy Online (Natural) - English (United States)', 'en-US'))
    ).toBe('male');
  });

  it('does not read "male" inside "Female"', () => {
    expect(voiceGender(voice('Female Voice 1', 'en-US'))).toBe('female');
  });

  it('marks a name it does not know as unknown, not as either', () => {
    expect(voiceGender(voice('Google US English', 'en-US'))).toBeNull();
  });
});

describe('voiceTier', () => {
  it('ranks neural above online above desktop', () => {
    const natural = voice('Microsoft Ryan Online (Natural) - English (United Kingdom)', 'en-GB');
    const google = voice('Google UK English Male', 'en-GB');
    const desktop = voice('Microsoft David - English (United States)', 'en-US');

    expect(voiceTier(natural)).toBeLessThan(voiceTier(google));
    expect(voiceTier(google)).toBeLessThan(voiceTier(desktop));
  });
});

describe('pickVoice, by kind', () => {
  /*
   * Rework plan PR 6b. This is the machine the user heard it on: David, Mark
   * and Zira, and no British English at all. Picking the Nth voice by name gave
   * the Sergeant — en-GB variant 2 — Zira.
   */
  it('never hands a coach who asks for a male voice the female one', () => {
    const picked = [0, 1, 2, 3].map((variant) => pickVoice(US_ONLY, 'en-GB', variant, 'male'));
    expect(picked.map((v) => v?.name)).not.toContain('Microsoft Zira - English (United States)');
  });

  it('gives the kind asked for when the device has it', () => {
    expect(pickVoice(US_ONLY, 'en-US', 0, 'female')?.name).toBe(
      'Microsoft Zira - English (United States)'
    );
  });

  it('falls back to the whole language when the device has none of that kind', () => {
    const onlyMen = US_ONLY.filter((v) => voiceGender(v) === 'male');
    expect(pickVoice(onlyMen, 'en-US', 0, 'female')?.lang).toBe('en-US');
  });

  it('takes the better voice first, where the browser offers one', () => {
    const edge = [
      voice('Microsoft David - English (United States)', 'en-US'),
      voice('Microsoft Guy Online (Natural) - English (United States)', 'en-US'),
    ];
    expect(pickVoice(edge, 'en-US', 0, 'male')?.name).toContain('Natural');
  });

  it('keeps the old choice for a caller that names no kind', () => {
    expect(pickVoice(MIXED, 'en-GB', 1)?.name).toBe(pickVoice(MIXED, 'en-GB', 1, null)?.name);
  });
});

/** A coach's voice fields, as the reader returns them. */
const sergeant = {
  voice: 'en-GB',
  voiceVariant: 1,
  voiceGender: 'male' as const,
  pitch: 0.8,
  rate: 1.2,
};

describe('personaSpeech', () => {
  it("speaks with the coach's own row — language, kind, variant, pitch and rate", () => {
    expect(personaSpeech(sergeant, false)).toEqual({
      lang: 'en-GB',
      gender: 'male',
      variant: 1,
      pitch: 0.8,
      rate: 1.2,
    });
  });

  it('slows a gentle week without changing who is speaking', () => {
    // The words soften by resolveTone; the voice slows and keeps its pitch, its
    // character. Lowering the pitch would make the coach someone else.
    const gentle = personaSpeech(sergeant, true);
    expect(gentle.rate).toBeCloseTo(1.2 * GENTLE_RATE_FACTOR, 10);
    expect(gentle.pitch).toBe(0.8);
    expect(gentle.gender).toBe('male');
  });

  it('takes a plain voice before any coach is known', () => {
    expect(personaSpeech(null, false)).toEqual({
      lang: null,
      gender: null,
      variant: 0,
      pitch: 1,
      rate: 1,
    });
  });
});

describe('previewSpeech', () => {
  const rival = { ...sergeant, sampleLine: 'Your move.', voiceVariant: 2, pitch: 1, rate: 1.1 };

  it('sounds exactly like an ordinary delivery from the same coach', () => {
    // FOUND IN REVIEW of PR #46: the preview's settings and the delivery's were
    // built separately. Both come from personaSpeech; this holds them together.
    expect(previewSpeech(rival)).toEqual({
      text: 'Your move.',
      options: personaSpeech(rival, false),
    });
  });

  it('never slows the preview, which has no training week to be gentle about', () => {
    expect(previewSpeech(rival)!.options.rate).toBe(1.1);
  });

  it('offers nothing for a row with no line, rather than a button that says nothing', () => {
    expect(previewSpeech({ ...rival, sampleLine: null })).toBeNull();
    expect(previewSpeech({ ...rival, sampleLine: '   ' })).toBeNull();
  });

  it('trims the line it speaks', () => {
    expect(previewSpeech({ ...rival, sampleLine: '  Your move.  ' })!.text).toBe('Your move.');
  });
});
