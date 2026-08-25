/**
 * Tonnage — external load moved, in kilograms.
 *
 * INVARIANT: deterministic code computes this, never a model — CLAUDE.md #1.
 * INVARIANT: kilograms are canonical — CLAUDE.md #8. Imperial is a display
 *            concern and never reaches this file.
 */
import { startOfWeek } from './dates';
import type { ExerciseMuscles, LocalDate, SetRecord } from './types';

export interface TonnageOptions {
  /** Warmups are excluded by default: they inflate volume without driving it. */
  includeWarmups?: boolean;
}

/**
 * WHY external load only: a bodyweight pull-up contributes zero here.
 *
 * The alternative is imputing `users.bodyweight_kg`, and phase 0 deliberately
 * stores a single current weight rather than a series. Imputing would mean a
 * user updating their weight silently rewrites months of historical tonnage —
 * every past number changes, and no chart the coach has already commented on
 * still agrees with itself. Zero is wrong in a fixed, explainable direction;
 * imputation is wrong in a moving one.
 *
 * AI-NOTE: if bodyweight-inclusive tonnage is ever wanted, it needs a
 *          bodyweight time series first. Do not reach for users.bodyweight_kg.
 */
export function setTonnage(set: SetRecord, options: TonnageOptions = {}): number {
  if (!options.includeWarmups && set.isWarmup) return 0;
  const { weightKg, reps } = set;
  if (weightKg === null || reps === null) return 0;
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return 0;
  if (weightKg <= 0 || reps <= 0) return 0;
  return weightKg * reps;
}

export function totalTonnage(sets: readonly SetRecord[], options: TonnageOptions = {}): number {
  return sets.reduce((sum, set) => sum + setTonnage(set, options), 0);
}

/** Tonnage per local date, ascending. Days with no work are absent, not zero. */
export function tonnageByDate(
  sets: readonly SetRecord[],
  options: TonnageOptions = {}
): Map<LocalDate, number> {
  const byDate = new Map<LocalDate, number>();
  for (const set of sets) {
    const load = setTonnage(set, options);
    if (load === 0) continue;
    byDate.set(set.localDate, (byDate.get(set.localDate) ?? 0) + load);
  }
  return new Map([...byDate].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Keyed by the Monday starting each ISO week. */
export function tonnageByWeek(
  sets: readonly SetRecord[],
  options: TonnageOptions = {}
): Map<LocalDate, number> {
  const byWeek = new Map<LocalDate, number>();
  for (const set of sets) {
    const load = setTonnage(set, options);
    if (load === 0) continue;
    const week = startOfWeek(set.localDate);
    byWeek.set(week, (byWeek.get(week) ?? 0) + load);
  }
  return new Map([...byWeek].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export interface MuscleTonnageOptions extends TonnageOptions {
  /**
   * Share of a set's load credited to each secondary muscle.
   *
   * WHY configurable and WHY 0.5: there is no measured truth here — it is a
   * convention. Making it a parameter keeps it visible and tunable instead of
   * hiding a magic number inside a sum, and lets the phase 2 volume caps be
   * expressed against a stated assumption.
   */
  secondaryWeight?: number;
}

export const DEFAULT_SECONDARY_WEIGHT = 0.5;

/**
 * Tonnage attributed to muscles. Totals across muscles deliberately exceed
 * total tonnage, because one set trains more than one muscle.
 */
export function tonnageByMuscle(
  sets: readonly SetRecord[],
  catalogue: readonly ExerciseMuscles[],
  options: MuscleTonnageOptions = {}
): Map<string, number> {
  const secondaryWeight = options.secondaryWeight ?? DEFAULT_SECONDARY_WEIGHT;
  const byExercise = new Map(catalogue.map((entry) => [entry.exerciseId, entry]));
  const byMuscle = new Map<string, number>();

  const add = (muscle: string, load: number) => {
    if (load === 0) return;
    byMuscle.set(muscle, (byMuscle.get(muscle) ?? 0) + load);
  };

  for (const set of sets) {
    const load = setTonnage(set, options);
    if (load === 0) continue;

    // An exercise missing from the catalogue is dropped rather than guessed at.
    const entry = byExercise.get(set.exerciseId);
    if (!entry) continue;

    add(entry.primaryMuscle, load);
    for (const muscle of entry.secondaryMuscles) add(muscle, load * secondaryWeight);
  }

  return byMuscle;
}
