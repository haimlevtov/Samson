/**
 * How much of a template has actually been done.
 *
 * INVARIANT: the LLM never computes a number — CLAUDE.md #1. This is the one
 *            derived figure the template feature puts in front of a user, so it
 *            is a pure function with unit tests rather than a count assembled
 *            in a component.
 *
 * INVARIANT: progress is derived from `sets`, never stored — ADR 0010. Nothing
 *            here writes, and there is no counter to drift when a set is
 *            deleted.
 *
 * Contract: docs/specs/workout-templates.md §4.
 */

export interface PrescribedItem {
  id: string;
  exerciseId: string;
  setCount: number;
}

/** The parts of a logged set this needs. Structural, so callers can pass rows. */
export interface LoggedSetLike {
  exerciseId: string;
  isWarmup: boolean;
}

export interface ItemProgress {
  itemId: string;
  prescribed: number;
  /** Never above `prescribed`. Surplus is reported in `extraSets`. */
  done: number;
}

export interface TemplateProgress {
  items: ItemProgress[];
  prescribedSets: number;
  completedSets: number;
  /** Working sets of a prescribed movement beyond what was asked for. */
  extraSets: number;
  /** `completedSets / prescribedSets`, and 0 when nothing is prescribed. */
  ratio: number;
}

/**
 * Allocates logged working sets to prescribed groups, in the order given.
 *
 * WHY in order rather than by matching weight and reps: a logged set does not
 * record which group it belonged to, and it frequently will not match one — the
 * prescription said 60 kg and the day said 57.5. Matching on the numbers would
 * make a session that went slightly heavy read as 0% complete. Order needs no
 * extra data and no guesswork, and it is right for the case that actually
 * happens: a ramp of `1x5 @ 60` then `3x5 @ 70` is worked through top to
 * bottom.
 *
 * AI-NOTE: `items` must arrive in ascending `position`. The loader orders them;
 *          this function trusts that rather than re-sorting, because it is also
 *          how the same list is rendered, and two orderings of one list is how
 *          the bar and the checkmarks would come to disagree.
 */
export function templateProgress(
  items: readonly PrescribedItem[],
  sets: readonly LoggedSetLike[]
): TemplateProgress {
  // Warm-ups never count toward a target: a template prescribes working sets,
  // and tonnage already excludes warm-ups for the same reason.
  const remaining = new Map<string, number>();
  for (const set of sets) {
    if (set.isWarmup) continue;
    remaining.set(set.exerciseId, (remaining.get(set.exerciseId) ?? 0) + 1);
  }

  const progress: ItemProgress[] = [];
  let prescribedSets = 0;
  let completedSets = 0;

  for (const item of items) {
    const available = remaining.get(item.exerciseId) ?? 0;
    const done = Math.min(item.setCount, available);
    remaining.set(item.exerciseId, available - done);

    progress.push({ itemId: item.id, prescribed: item.setCount, done });
    prescribedSets += item.setCount;
    completedSets += done;
  }

  // Only movements this template asked for. Sets of anything else are not
  // extra work against this plan — they are different work, and counting them
  // here would let an unrelated exercise inflate the session's summary.
  const prescribedExercises = new Set(items.map((i) => i.exerciseId));
  let extraSets = 0;
  for (const [exerciseId, left] of remaining) {
    if (prescribedExercises.has(exerciseId)) extraSets += left;
  }

  return {
    items: progress,
    prescribedSets,
    completedSets,
    extraSets,
    ratio: prescribedSets === 0 ? 0 : completedSets / prescribedSets,
  };
}
