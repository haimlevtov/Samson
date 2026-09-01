/**
 * PLAN.md phase 3: "Tone override forces a gentler register on injury or
 * missed-session flags, REGARDLESS of selected persona."
 *
 * The word doing the work is "regardless", so every case here runs across all
 * three shipped personas rather than one.
 */
import { describe, expect, it } from 'vitest';
import type { Persona } from './schema';
import { GENTLE_ADHERENCE_THRESHOLD, GENTLE_MAX_INTENSITY, resolveTone, toneFlags } from './tone';

const persona = (over: Partial<Persona> = {}): Persona => ({
  slug: 'rival',
  name: 'The Rival',
  systemPrompt: 'competitive',
  intensity: 5,
  humorLevel: 'crude',
  bannedPhrases: [],
  ...over,
});

/** The three shipped personas at their configured settings. */
const ALL: Persona[] = [
  persona({ slug: 'rival', intensity: 5, humorLevel: 'crude' }),
  persona({ slug: 'analyst', name: 'The Analyst', intensity: 2, humorLevel: 'clean' }),
  persona({ slug: 'old-master', name: 'The Old Master', intensity: 3, humorLevel: 'cheeky' }),
];

const calm = { notes: ['felt good'], adherenceRate: 0.95 };

describe('toneFlags', () => {
  it.each([
    ['right knee pain on the last set'],
    ['tweaked my shoulder'],
    ['lower back strain, stopped early'],
    ['something popped'],
    ['old injury flared up'],
  ])('flags injury in: %s', (note) => {
    expect(toneFlags({ notes: [note], adherenceRate: 0.9 }).injury).toBe(true);
  });

  it.each([
    ['legs are sore from Tuesday'],
    ['kept my core tight throughout'],
    ['felt heavy but moved well'],
  ])('does NOT flag ordinary training talk: %s', (note) => {
    // Over-triggering is not the safe direction: a permanently gentle coach is
    // a persona feature that has quietly stopped existing. See tone.ts.
    expect(toneFlags({ notes: [note], adherenceRate: 0.9 }).injury).toBe(false);
  });

  it('flags missed sessions below the threshold and not at it', () => {
    const at = toneFlags({ notes: [], adherenceRate: GENTLE_ADHERENCE_THRESHOLD });
    const below = toneFlags({ notes: [], adherenceRate: GENTLE_ADHERENCE_THRESHOLD - 0.01 });
    expect(at.missedSessions).toBe(false);
    expect(below.missedSessions).toBe(true);
  });

  it('does not treat "nothing resolved yet" as missing sessions', () => {
    // null and 0 are opposite facts — adherence.ts keeps them apart and so
    // must anything reading it.
    expect(toneFlags({ notes: [], adherenceRate: null }).missedSessions).toBe(false);
  });

  it('handles a null note without throwing', () => {
    expect(toneFlags({ notes: [null], adherenceRate: 0.9 }).injury).toBe(false);
  });
});

describe('resolveTone — the override applies regardless of persona', () => {
  it.each(ALL.map((p) => [p.slug, p] as const))(
    '%s: an injury note forces the override on',
    (_slug, p) => {
      const tone = resolveTone(p, 'crude', { notes: ['knee pain'], adherenceRate: 0.95 });
      expect(tone.gentle).toBe(true);
      expect(tone.override).not.toBeNull();
      expect(tone.intensity).toBeLessThanOrEqual(GENTLE_MAX_INTENSITY);
      expect(tone.humorLevel).toBe('clean');
    }
  );

  it.each(ALL.map((p) => [p.slug, p] as const))(
    '%s: missed sessions force the override on',
    (_slug, p) => {
      const tone = resolveTone(p, 'crude', { notes: [], adherenceRate: 0.4 });
      expect(tone.gentle).toBe(true);
      expect(tone.intensity).toBeLessThanOrEqual(GENTLE_MAX_INTENSITY);
    }
  );

  it.each(ALL.map((p) => [p.slug, p] as const))(
    '%s: no flags leaves the persona at its own settings',
    (_slug, p) => {
      const tone = resolveTone(p, 'crude', calm);
      expect(tone.gentle).toBe(false);
      expect(tone.override).toBeNull();
      expect(tone.intensity).toBe(p.intensity);
      expect(tone.humorLevel).toBe(p.humorLevel);
    }
  );
});

describe('resolveTone — the user ceiling', () => {
  it('a user who chose clean cannot be handed crude by picking the Rival', () => {
    const tone = resolveTone(persona(), 'clean', calm);
    expect(tone.humorLevel).toBe('clean');
  });

  it('never raises a persona above its own setting', () => {
    const analyst = persona({ humorLevel: 'clean' });
    expect(resolveTone(analyst, 'crude', calm).humorLevel).toBe('clean');
  });

  it('takes the lower of the two ceilings', () => {
    const cheeky = persona({ humorLevel: 'cheeky' });
    expect(resolveTone(cheeky, 'crude', calm).humorLevel).toBe('cheeky');
    expect(resolveTone(cheeky, 'clean', calm).humorLevel).toBe('clean');
  });
});
