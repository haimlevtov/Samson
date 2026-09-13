import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from './icons';
import { RUNG_ICON, RUNG_TONE, rungState, treeIcon, type RungState } from './trees';

const STATES: RungState[] = ['unlocked', 'next', 'cleared', 'locked'];

describe('rungState', () => {
  it('names the four states unlockStates distinguishes, cleared before locked', () => {
    expect(rungState({ unlocked: true, next: false, met: true })).toBe('unlocked');
    expect(rungState({ unlocked: false, next: true, met: false })).toBe('next');
    // Criteria met below an unopened rung: the tree says go back, not "locked".
    expect(rungState({ unlocked: false, next: false, met: true })).toBe('cleared');
    expect(rungState({ unlocked: false, next: false, met: false })).toBe('locked');
  });
});

describe('how a rung and a tree are drawn', () => {
  it('gives every state a ground and an icon that exists', () => {
    for (const state of STATES) {
      expect(RUNG_TONE[state], state).toBeDefined();
      expect(ICON_NAMES).toContain(RUNG_ICON[state]);
    }
  });

  it('draws every tree the schema allows with an icon that exists', () => {
    // Read from the CHECK, not typed again — the tier test's lesson.
    const sql = readFileSync(
      join(__dirname, '..', '..', 'supabase', 'migrations', '20260824150203_catalogue.sql'),
      'utf8'
    );
    const check = sql.match(/check \(tree in \(([^)]*)\)\)/);
    expect(check, 'the tree CHECK moved; point this test at it').not.toBeNull();
    const trees = [...check![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(trees.length).toBeGreaterThan(0);
    for (const tree of trees) {
      expect(treeIcon(tree), tree).not.toBe('route');
      expect(ICON_NAMES).toContain(treeIcon(tree));
    }
  });

  it('draws a tree nobody has named an icon for', () => {
    expect(treeIcon('grip')).toBe('route');
  });
});
