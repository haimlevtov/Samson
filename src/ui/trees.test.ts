import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from './icons';
import { RUNG_ICON, rungState, treeIcon } from './trees';

describe('rungState', () => {
  it('names the four states unlockStates distinguishes', () => {
    expect(rungState({ unlocked: true, next: false, met: true })).toBe('unlocked');
    expect(rungState({ unlocked: false, next: true, met: false })).toBe('next');
    expect(rungState({ unlocked: false, next: false, met: true })).toBe('cleared');
    expect(rungState({ unlocked: false, next: false, met: false })).toBe('locked');
  });

  it('says "cleared" rather than "locked" when the criteria are met below an unopened rung', () => {
    // The tree is telling somebody to go back — that must not read as a refusal.
    expect(rungState({ unlocked: false, next: false, met: true })).not.toBe('locked');
  });
});

describe('the tree and rung icons', () => {
  it('draws every state and every shipped tree with an icon that exists', () => {
    for (const icon of Object.values(RUNG_ICON)) expect(ICON_NAMES).toContain(icon);
    for (const tree of ['push', 'pull', 'legs', 'core'])
      expect(ICON_NAMES).toContain(treeIcon(tree));
  });

  it('draws a tree nobody has named an icon for', () => {
    expect(treeIcon('grip')).toBe('route');
  });
});
