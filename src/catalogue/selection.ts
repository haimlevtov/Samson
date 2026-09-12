/**
 * What a "select all" box does, and what state it should show — ADR 0029's
 * picker, rework PR 8.
 *
 * WHY this is not three lines inside the component. Nothing under `app/` is in
 * the unit suite — `vitest.config.ts` includes `src/**` and `tests/unit/**` — so
 * a rule written there is a rule nothing can fail on. This PR makes that
 * argument twice already, at `src/onboarding/schema.ts` and
 * `src/persona/choice.ts`, and the select-all shipped without it until review
 * pointed out the inconsistency.
 *
 * Three decisions live here, and each of them could plausibly have gone the
 * other way, which is exactly what makes them worth pinning.
 */

/** Which of the three states the box should show. */
export type SelectAllState = 'none' | 'some' | 'all';

/**
 * The state of the box, given how many tags exist and how many are ticked.
 *
 * `'some'` is the one that needs a DOM property rather than an attribute —
 * `indeterminate` — and without it a partial selection renders as an empty box,
 * which reads as "nothing is selected" while five things are.
 *
 * An EMPTY catalogue is `'none'`, not `'all'`: `0 === 0` is true and would light
 * the box up over a list with nothing in it. The component renders no control at
 * all in that case, and this function agrees with it rather than relying on it.
 */
export function selectAllState(total: number, selected: number): SelectAllState {
  if (total === 0 || selected === 0) return 'none';
  return selected >= total ? 'all' : 'some';
}

/**
 * What pressing the box selects next.
 *
 * PARTIAL COUNTS AS NOT-ALL, so the first press fills in the rest rather than
 * clearing what is already ticked. Undoing somebody's selection is not what they
 * asked for by pressing a box labelled "all" — and a user who wants to start
 * again can press it twice.
 *
 * Returns a new Set; the caller's is never mutated, because it is React state.
 */
export function nextSelectAll(
  slugs: readonly string[],
  selected: ReadonlySet<string>
): Set<string> {
  return selectAllState(slugs.length, selected.size) === 'all' ? new Set<string>() : new Set(slugs);
}
