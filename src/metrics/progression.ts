/**
 * Progression — one lift's heaviest working set, session by session.
 *
 * INVARIANT: the LLM never computes a number — CLAUDE.md #1. Every point on the
 *            chart is arithmetic over logged sets.
 *
 * Design and reasoning: ADR 0014. The short version is that this plots the
 * weight the user CHOSE rather than the 1RM the app inferred, because a
 * progression chart is read to answer "am I getting stronger" and a figure
 * nobody can tie to a session they did is the fastest way to lose that answer.
 *
 * Pure over plain shapes, like the rest of `src/metrics/` — no database, no
 * clock, no DOM. The component takes points and draws them.
 */
import { compareDates } from './dates';
import type { LocalDate, SetRecord } from './types';

export interface ProgressionPoint {
  localDate: LocalDate;
  /** The heaviest working set that day, in kilograms. */
  weightKg: number;
  /** Reps at that weight. Null when the set recorded none. */
  reps: number | null;
}

/**
 * A set is worth plotting only if it says something about strength.
 *
 * WHY warmups are excluded: the same reason `exerciseBests` excludes them. A
 * 20 kg warm-up is not a data point about how strong somebody is, and one of
 * them on the chart flattens the axis for everything else.
 *
 * WHY a null weight is excluded rather than plotted as zero: bodyweight
 * movements genuinely have no external load (`src/metrics/types.ts`), and a
 * zero would be a claim. ADR 0014 — inventing a bodyweight figure would rewrite
 * the user's history every time their weight changed.
 */
function plottable(set: SetRecord): boolean {
  if (set.isWarmup) return false;
  return set.weightKg !== null && set.weightKg > 0;
}

/**
 * The heaviest working set of `exerciseId` on each day it was trained, oldest
 * first.
 *
 * One point per DAY rather than per workout row: `workouts` has no unique
 * constraint on `(user_id, local_date)`, so two sessions in one afternoon would
 * otherwise put two points on the same x position — the same reasoning that
 * made `sessions` count distinct days in the challenge spec.
 *
 * AI-NOTE: ties on weight keep the set with the MOST reps, because 80×8 is a
 *          better day than 80×3 and the chart should not flip between them on
 *          array order. Without this the label under a point could change
 *          between renders while the line stayed still.
 */
export function exerciseProgression(
  sets: readonly SetRecord[],
  exerciseId: string
): ProgressionPoint[] {
  const best = new Map<LocalDate, ProgressionPoint>();

  for (const set of sets) {
    if (set.exerciseId !== exerciseId || !plottable(set)) continue;

    const weightKg = set.weightKg as number;
    const current = best.get(set.localDate);

    if (
      current === undefined ||
      weightKg > current.weightKg ||
      (weightKg === current.weightKg && (set.reps ?? 0) > (current.reps ?? 0))
    ) {
      best.set(set.localDate, { localDate: set.localDate, weightKg, reps: set.reps });
    }
  }

  return [...best.values()].sort((a, b) => compareDates(a.localDate, b.localDate));
}

export interface ProgressionRange {
  min: number;
  max: number;
}

/**
 * The weight range a chart should cover.
 *
 * WHY it is not simply `[min, max]` of the data: a lift that has sat at 100 kg
 * for six sessions has min === max, and a chart drawn on a zero-height axis
 * either divides by zero or draws every point on top of the others. Padding it
 * gives a flat line down the middle, which is the honest picture of a plateau.
 *
 * WHY the axis does not start at zero: this is a change chart, not a magnitude
 * chart. Anchoring at zero on a 100 kg squat compresses a 10 kg improvement into
 * a tenth of the height and makes real progress invisible, which is the failure
 * this whole feature exists to avoid.
 */
export function progressionRange(points: readonly ProgressionPoint[]): ProgressionRange {
  if (points.length === 0) return { min: 0, max: 1 };

  const weights = points.map((p) => p.weightKg);
  const min = Math.min(...weights);
  const max = Math.max(...weights);

  if (min === max) {
    // A tenth either side, and never below zero — a 5 kg lift must not get a
    // negative floor.
    const pad = Math.max(1, min * 0.1);
    return { min: Math.max(0, min - pad), max: min + pad };
  }

  return { min, max };
}
