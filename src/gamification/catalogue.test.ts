/**
 * Tests for `src/gamification/catalogue.ts`, written from ADR 0017's 2026-09-12
 * amendment and `docs/specs/mobile-interface.md` §4.
 *
 * What the database withholds is tested in `tests/db/achievements.test.ts`,
 * under "the badge catalogue".
 * What is pinned here is what the catalogue does with whatever it is given: who
 * sees an unearned name, the order a person reads, and a count that cannot
 * render as nonsense.
 */
import { describe, expect, it } from 'vitest';
import {
  aboveCeilingLine,
  buildCatalogue,
  hiddenLine,
  humorCeiling,
  type HeldRow,
  type VisibleRow,
} from './catalogue';

const visible = (slug: string, over: Partial<VisibleRow> = {}): VisibleRow => ({
  slug,
  name: slug,
  howToEarn: `Do the ${slug} thing.`,
  tier: 'consistency',
  humorLevel: 'clean',
  ...over,
});

const held = (slug: string, localDate: string, over: Partial<HeldRow> = {}): HeldRow => ({
  slug,
  name: slug,
  description: `You did the ${slug} thing.`,
  tier: 'consistency',
  hidden: false,
  sourceHint: null,
  localDate,
  unlockedAt: `${localDate}T12:00:00+00:00`,
  ...over,
});

const build = (over: Partial<Parameters<typeof buildCatalogue>[0]> = {}) =>
  buildCatalogue({ visible: [], held: [], hiddenRemaining: 0, humorCeiling: 'cheeky', ...over });

describe('what is earned', () => {
  it('is everything held, hidden badges included, with the reward copy', () => {
    const catalogue = build({
      visible: [visible('seven')],
      held: [held('seven', '2026-09-01'), held('groundhog', '2026-09-03', { hidden: true })],
    });

    expect(catalogue.earned.map((b) => b.slug)).toEqual(['groundhog', 'seven']);
    expect(catalogue.earned[0]).toMatchObject({
      hidden: true,
      description: 'You did the groundhog thing.',
      earnedOn: '2026-09-03',
    });
  });

  it('opens on the newest instant, not the newest date or the first name', () => {
    const catalogue = build({
      held: [
        held('b-older', '2026-08-01'),
        held('a-this-morning', '2026-09-02', { unlockedAt: '2026-09-02T07:00:00+00:00' }),
        // Earned later the same day; would sort second by name.
        held('z-this-evening', '2026-09-02', { unlockedAt: '2026-09-02T19:30:00.5+00:00' }),
        // A later instant on an EARLIER local date — a change of timezone.
        held('m-after-a-flight', '2026-09-01', { unlockedAt: '2026-09-02T21:00:00+00:00' }),
      ],
    });

    expect(catalogue.earned.map((b) => b.slug)).toEqual([
      'm-after-a-flight',
      'z-this-evening',
      'a-this-morning',
      'b-older',
    ]);
  });

  it('breaks a tie on the instant by name', () => {
    const at = '2026-09-02T07:00:00+00:00';
    const catalogue = build({
      held: [
        held('zed', '2026-09-02', { unlockedAt: at }),
        held('abe', '2026-09-02', { unlockedAt: at }),
      ],
    });

    expect(catalogue.earned.map((b) => b.slug)).toEqual(['abe', 'zed']);
  });

  it('is shown above the humour ceiling — a person always sees what they have', () => {
    const catalogue = build({
      visible: [visible('rude', { humorLevel: 'crude' })],
      held: [held('rude', '2026-09-01')],
      humorCeiling: 'clean',
    });

    expect(catalogue.earned.map((b) => b.slug)).toEqual(['rude']);
    expect(catalogue.toGet).toEqual([]);
  });
});

describe('what is still to get', () => {
  it('is every visible badge not held, alphabetically, with how to earn it', () => {
    const catalogue = build({
      visible: [visible('zeta'), visible('alpha'), visible('held-one')],
      held: [held('held-one', '2026-09-01')],
    });

    expect(catalogue.toGet).toEqual([
      { slug: 'alpha', name: 'alpha', howToEarn: 'Do the alpha thing.', tier: 'consistency' },
      { slug: 'zeta', name: 'zeta', howToEarn: 'Do the zeta thing.', tier: 'consistency' },
    ]);
  });

  it('stops at the humour ceiling, inclusive', () => {
    const rows = [
      visible('clean-one', { humorLevel: 'clean' }),
      visible('cheeky-one', { humorLevel: 'cheeky' }),
      visible('crude-one', { humorLevel: 'crude' }),
    ];
    const slugsAt = (ceiling: 'clean' | 'cheeky' | 'crude') =>
      build({ visible: rows, humorCeiling: ceiling }).toGet.map((b) => b.slug);

    expect(slugsAt('clean')).toEqual(['clean-one']);
    expect(slugsAt('cheeky')).toEqual(['cheeky-one', 'clean-one']);
    expect(slugsAt('crude')).toEqual(['cheeky-one', 'clean-one', 'crude-one']);
  });

  it('counts what the ceiling removed, and never a badge already held', () => {
    const catalogue = build({
      visible: [
        visible('cheeky-one', { humorLevel: 'cheeky' }),
        visible('crude-one', { humorLevel: 'crude' }),
        visible('crude-held', { humorLevel: 'crude' }),
        visible('fine'),
      ],
      held: [held('crude-held', '2026-09-01')],
      humorCeiling: 'clean',
    });

    expect(catalogue.aboveCeiling).toBe(2);
    expect(build({ visible: [visible('fine')], humorCeiling: 'clean' }).aboveCeiling).toBe(0);
  });

  it('leaves out a row whose humour level is not one of the three', () => {
    // indexOf returns -1 for it, which is below every ceiling. Without the
    // explicit check, an unreadable level would be shown to everybody.
    const catalogue = build({
      visible: [visible('mystery', { humorLevel: 'filthy' }), visible('fine')],
      humorCeiling: 'clean',
    });

    expect(catalogue.toGet.map((b) => b.slug)).toEqual(['fine']);
    expect(catalogue.aboveCeiling).toBe(1);
  });
});

describe('the hidden count', () => {
  it('passes an integer through', () => {
    expect(build({ hiddenRemaining: 2 }).hiddenRemaining).toBe(2);
  });

  it.each([[-1], [2.7], [Number.NaN], [Number.POSITIVE_INFINITY], [null]])(
    'reads %s as no count at all, rather than as zero',
    (given) => {
      expect(build({ hiddenRemaining: given }).hiddenRemaining).toBeNull();
    }
  );

  it('keeps zero, which is a count', () => {
    expect(build({ hiddenRemaining: 0 }).hiddenRemaining).toBe(0);
  });
});

describe('the line under the hidden count', () => {
  it('counts what is left, singular and plural', () => {
    expect(hiddenLine(build({ hiddenRemaining: 1 }))).toBe('1 hidden badge left to find.');
    expect(hiddenLine(build({ hiddenRemaining: 2 }))).toBe('2 hidden badges left to find.');
  });

  it('congratulates only somebody who holds a hidden badge', () => {
    const found = build({ held: [held('groundhog', '2026-09-01', { hidden: true })] });
    expect(hiddenLine(found)).toBe('You found every hidden badge.');

    // Zero left and none held means none exist. That is not an achievement.
    expect(hiddenLine(build({ held: [held('seven', '2026-09-01')] }))).toBeNull();
  });

  it('says nothing when the count could not be read — not "you found them all"', () => {
    const holder = build({
      held: [held('groundhog', '2026-09-01', { hidden: true })],
      hiddenRemaining: Number.NaN,
    });
    expect(hiddenLine(holder)).toBeNull();
  });
});

describe('the line for badges above the humour setting', () => {
  it('counts them, singular and plural', () => {
    expect(aboveCeilingLine(1)).toBe('1 more badge is above your humour setting.');
    expect(aboveCeilingLine(4)).toBe('4 more badges are above your humour setting.');
  });
});

describe('the humour ceiling', () => {
  it('reads the three levels as themselves', () => {
    expect(humorCeiling('clean')).toBe('clean');
    expect(humorCeiling('cheeky')).toBe('cheeky');
    expect(humorCeiling('crude')).toBe('crude');
  });

  it('reads anything else, and nothing at all, as the strictest', () => {
    expect(humorCeiling('')).toBe('clean');
    expect(humorCeiling('CRUDE')).toBe('clean');
    expect(humorCeiling(null)).toBe('clean');
  });
});
