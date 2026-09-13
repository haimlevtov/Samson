/**
 * How the progression trees are drawn — the Quest Log redesign, ADR 0033.
 *
 * INVARIANT: presentation only. Whether a rung is open is `unlockStates`'s
 *            decision (ADR 0020); this names the four states it already
 *            distinguishes so the page can draw each one, and nothing here reads
 *            a set.
 */
import type { UnlockState } from '../gamification/unlocks';
import type { IconName } from './icons';

export type RungState = 'unlocked' | 'next' | 'cleared' | 'locked';

/**
 * `cleared` is the interesting one: the rung's own criteria are met but a rung
 * below is not, so the tree is telling somebody to go back rather than refusing
 * silently. It is checked before `locked` for exactly that reason.
 */
export function rungState(state: Pick<UnlockState, 'unlocked' | 'next' | 'met'>): RungState {
  if (state.unlocked) return 'unlocked';
  if (state.next) return 'next';
  if (state.met) return 'cleared';
  return 'locked';
}

export const RUNG_ICON: Readonly<Record<RungState, IconName>> = {
  unlocked: 'check',
  next: 'target',
  cleared: 'lock-open',
  locked: 'lock',
};

const TREE_ICON: Readonly<Record<string, IconName>> = {
  push: 'arrow-up-from-line',
  pull: 'arrow-down-to-line',
  legs: 'footprints',
  core: 'circle-dot',
};

/** A tree's icon. A fifth tree added by migration draws a route rather than nothing. */
export function treeIcon(tree: string): IconName {
  return TREE_ICON[tree] ?? 'route';
}
