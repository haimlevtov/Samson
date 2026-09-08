/**
 * Inputs to the metrics engine.
 *
 * WHY: these are plain shapes, not rows from src/db/types.ts. The engine is the
 *      part of the system that must be trivially testable — invariant #1 says
 *      every number a user sees comes from here, so it cannot need a database
 *      to prove itself correct. Callers map database rows onto these.
 */

export type WorkoutStatus = 'planned' | 'in_progress' | 'completed' | 'skipped' | 'rest';

/** A local calendar date, `YYYY-MM-DD`, already resolved in the user's timezone. */
export type LocalDate = string;

export interface SetRecord {
  exerciseId: string;
  /** Canonical kilograms — CLAUDE.md #8. Null for unloaded movements. */
  weightKg: number | null;
  reps: number | null;
  rpe?: number | null;
  isWarmup: boolean;
  /**
   * INVARIANT: the user's local date, never a server date — CLAUDE.md #9.
   * Resolved once at write time and carried through, so a user who travels
   * does not retroactively move their history between days.
   */
  localDate: LocalDate;
}

export interface WorkoutRecord {
  id: string;
  localDate: LocalDate;
  status: WorkoutStatus;
}

/** Muscle attribution for one exercise, from the catalogue. */
export interface ExerciseMuscles {
  exerciseId: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
}

/**
 * One row of `tonnage_comparisons`, in this layer's shape.
 *
 * Here rather than in `comparisons.ts` for the reason this file exists: it is a
 * database row mapped onto a plain shape, the same category as
 * `ExerciseMuscles`, and `index.ts` promises that everything the engine exports
 * is a pure function over the shapes in *this* file. `TonnageComparison`, which
 * is an output rather than an input, stays beside the function that builds it.
 */
export interface ComparisonObject {
  slug: string;
  /** With its article: "a double-decker bus", "the Statue of Liberty". */
  singular: string;
  /** Bare plural: "double-decker buses". */
  plural: string;
  massKg: number;
  /** The range this figure stands in for. Not a citation — see the migration. */
  sourceNote: string;
}
