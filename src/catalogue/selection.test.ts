import { describe, expect, it } from 'vitest';
import { nextSelectAll, selectAllState } from './selection';

const TAGS = ['barbell', 'bodyweight', 'dumbbell', 'kettlebell'];

describe('selectAllState', () => {
  it('is none when nothing is ticked', () => {
    expect(selectAllState(TAGS.length, 0)).toBe('none');
  });

  it('is all when everything is ticked', () => {
    expect(selectAllState(TAGS.length, TAGS.length)).toBe('all');
  });

  it('is some in between, which is the state HTML has no attribute for', () => {
    // `indeterminate` is a DOM property, so the component sets it through a ref.
    // Without this state a partial selection renders as an empty box, which
    // reads as "nothing is selected" while three things are.
    expect(selectAllState(TAGS.length, 1)).toBe('some');
    expect(selectAllState(TAGS.length, TAGS.length - 1)).toBe('some');
  });

  it('is none for an empty catalogue, not all', () => {
    // `0 >= 0` is true, so the naive version lights the box up over a list with
    // nothing in it. The component renders no control at all when the catalogue
    // is empty; this agrees with it rather than depending on it.
    expect(selectAllState(0, 0)).toBe('none');
  });
});

describe('nextSelectAll', () => {
  it('selects everything from nothing', () => {
    expect([...nextSelectAll(TAGS, new Set())].sort()).toEqual([...TAGS].sort());
  });

  it('fills in the rest from a partial selection, rather than clearing it', () => {
    /*
     * THE DECISION THIS PINS. Partial counts as not-all, so the first press
     * completes the set. Treating partial as "on" would make the first press
     * throw away what the user had already chosen — not what anybody means by
     * pressing a box labelled "all".
     */
    expect([...nextSelectAll(TAGS, new Set(['barbell']))].sort()).toEqual([...TAGS].sort());
  });

  it('clears everything from a full selection', () => {
    expect([...nextSelectAll(TAGS, new Set(TAGS))]).toEqual([]);
  });

  it('does not mutate the set it was given', () => {
    // It is React state on the other side of this call.
    const current = new Set(['barbell']);
    nextSelectAll(TAGS, current);
    expect([...current]).toEqual(['barbell']);
  });

  it('selects nothing when there is nothing to select', () => {
    expect([...nextSelectAll([], new Set())]).toEqual([]);
  });
});
