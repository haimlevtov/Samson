import { describe, expect, it } from 'vitest';
import type { UnlockedAchievement } from '../db/gamification';
import { nextFocusIndex, unlockSheetProps, withoutUnlocked } from './unlock';

const badge = (over: Partial<UnlockedAchievement> = {}): UnlockedAchievement => ({
  slug: 'twenty-percent-up',
  name: 'The Long Way Up',
  description: 'Twenty percent heavier.',
  tier: 'pr',
  hidden: false,
  sourceHint: null,
  unlockedAt: '2026-09-13T08:00:00+00:00',
  localDate: '2026-09-13',
  ...over,
});

describe('unlockSheetProps', () => {
  it('shows only a badge the caller holds', () => {
    expect(unlockSheetProps('twenty-percent-up', [badge()])).not.toBeNull();
    expect(unlockSheetProps('groundhog-set', [badge()])).toBeNull();
    expect(unlockSheetProps(undefined, [badge()])).toBeNull();
  });

  it('shows nothing for a repeated parameter, which arrives as an array', () => {
    expect(unlockSheetProps(['twenty-percent-up', 'x'], [badge()])).toBeNull();
  });

  it('sends exactly the fields the sheet renders', () => {
    // Anything added here reaches the browser; the date and instant do not.
    const props = unlockSheetProps('twenty-percent-up', [badge()]);
    expect(Object.keys(props!).sort()).toEqual(
      ['description', 'hidden', 'icon', 'metal', 'name', 'slug', 'sourceHint'].sort()
    );
    expect(props).toMatchObject({ metal: 'gold', icon: 'trending-up' });
  });

  it('draws a held hidden badge in obsidian whatever its tier', () => {
    const hidden = badge({ slug: 'groundhog-set', tier: 'volume', hidden: true });
    expect(unlockSheetProps('groundhog-set', [hidden])?.metal).toBe('obsidian');
  });
});

describe('withoutUnlocked', () => {
  it('drops only the unlocked parameter', () => {
    expect(withoutUnlocked('https://x.test/history?unlocked=a')).toBe('/history');
    expect(withoutUnlocked('https://x.test/history?page=2&unlocked=a#row')).toBe(
      '/history?page=2#row'
    );
    expect(withoutUnlocked('/history')).toBe('/history');
  });
});

describe('nextFocusIndex', () => {
  it('wraps forwards and backwards between two controls', () => {
    expect(nextFocusIndex(0, 2, false)).toBe(1);
    expect(nextFocusIndex(1, 2, false)).toBe(0);
    expect(nextFocusIndex(0, 2, true)).toBe(1);
    expect(nextFocusIndex(1, 2, true)).toBe(0);
  });

  it('brings focus from outside the modal to its first or last control', () => {
    expect(nextFocusIndex(-1, 2, false)).toBe(0);
    expect(nextFocusIndex(-1, 2, true)).toBe(1);
  });

  it('has nowhere to go with no controls', () => {
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
  });
});
