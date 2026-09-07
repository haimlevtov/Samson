/**
 * "Save this session as a template" — what was logged, collapsed into what to
 * prescribe next time.
 *
 * INVARIANT: no model is involved — CLAUDE.md #1. This is arithmetic over rows
 *            the user has already seen, so what they get back is recognisably
 *            the session they just did.
 *
 * Contract: docs/specs/workout-templates.md §5.
 */
import { MAX_TEMPLATE_ITEMS, type TemplateItemDraft } from './schema';

/** The parts of a logged set this needs. Structural, so callers pass rows. */
export interface SessionSetLike {
  exerciseId: string;
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  restSeconds: number | null;
  isWarmup: boolean;
}

export interface DerivedTemplate {
  items: TemplateItemDraft[];
  /**
   * The session held more groups than a template can carry, and the tail was
   * dropped.
   *
   * WHY this is reported rather than handled silently: a ramping session of
   * eight movements can genuinely exceed the cap, and a template that quietly
   * loses its last two exercises is worse than one that says it did.
   */
  truncated: boolean;
}

/** Bounds from templateItemDraftSchema. A set outside them is not prescribable. */
function prescribable(set: SessionSetLike): boolean {
  if (set.isWarmup) return false;
  // A set with no reps recorded says nothing about what to ask for next time.
  if (set.reps === null || !Number.isInteger(set.reps) || set.reps < 1 || set.reps > 50) {
    return false;
  }
  return set.weightKg === null || (set.weightKg >= 0 && set.weightKg <= 500);
}

/**
 * Consecutive identical sets collapse into one group.
 *
 * WHY `rpe` is dropped rather than carried: RPE is an outcome, not an
 * instruction. Three sets that felt 7, 8 and 9 are one prescription, and
 * grouping by RPE would shatter every derived template into single sets. A
 * target RPE can be added by hand; it is not inferred from how hard last
 * Tuesday happened to feel.
 *
 * AI-NOTE: exercises keep the order they appear in `sets`; within an exercise
 *          the sets are ordered by `setIndex`, because `set_index` is unique
 *          per (workout, exercise) and every exercise therefore starts at 0.
 *          Sorting the whole list by index would interleave the movements.
 */
export function templateFromSession(sets: readonly SessionSetLike[]): DerivedTemplate {
  const byExercise = new Map<string, SessionSetLike[]>();
  for (const set of sets) {
    if (!prescribable(set)) continue;
    const existing = byExercise.get(set.exerciseId);
    if (existing) existing.push(set);
    else byExercise.set(set.exerciseId, [set]);
  }

  const items: TemplateItemDraft[] = [];

  for (const [exerciseId, exerciseSets] of byExercise) {
    const ordered = [...exerciseSets].sort((a, b) => a.setIndex - b.setIndex);

    for (const set of ordered) {
      const previous = items.at(-1);
      const continues =
        previous !== undefined &&
        previous.exerciseId === exerciseId &&
        previous.reps === set.reps &&
        previous.weightKg === set.weightKg &&
        previous.setCount < 20;

      if (continues) {
        previous.setCount += 1;
        continue;
      }

      items.push({
        exerciseId,
        setCount: 1,
        // Narrowed by prescribable(); the cast-free check keeps that visible.
        reps: set.reps ?? 1,
        weightKg: set.weightKg,
        rpe: null,
        // The rest actually taken before the next set, from the first set of
        // the run. It is the only one of the three that is a decision rather
        // than a result.
        restSeconds: set.restSeconds,
      });
    }
  }

  return {
    items: items.slice(0, MAX_TEMPLATE_ITEMS),
    truncated: items.length > MAX_TEMPLATE_ITEMS,
  };
}
