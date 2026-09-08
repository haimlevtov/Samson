/**
 * Cumulative tonnage, expressed as a thing rather than a figure.
 *
 * INVARIANT: deterministic code computes this, never a model — CLAUDE.md #1.
 *            The model is allowed to talk about the answer; it is not allowed
 *            to decide that 140,000 kg is "about a whale".
 * INVARIANT: kilograms are canonical — CLAUDE.md #8. The objects carry mass in
 *            kg because the rest of the schema does; imperial is a display
 *            concern and never reaches this file.
 *
 * The objects themselves are rows in `tonnage_comparisons` — CLAUDE.md #7 —
 * so adding a whale is a migration. What lives here is the rule for picking
 * one, which is the part that has to be right every time.
 */

/** One row of `tonnage_comparisons`, in this layer's shape. */
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

export interface TonnageComparison {
  object: ComparisonObject;
  /** How many of it. At least 1 whenever this is returned at all. */
  count: number;
}

/**
 * The heaviest object the user has actually passed, and how many of it.
 *
 * WHY heaviest-passed rather than closest-fitting: the sentence has to shrink
 * as the user grows. Picking whichever object divides most neatly means a
 * five-year lifter is told they have moved thirty-one thousand cats, which is
 * arithmetically fine and reads as noise. One whale beats forty elephants beats
 * two thousand pianos, and the ladder in the table is built to keep the count
 * small at every level.
 *
 * Returns null when nothing has been lifted, or when the total has not yet
 * reached the lightest object in the table. Null is a real answer here — a
 * beginner with 3 kg logged should be told nothing rather than "about half a
 * cat", which is both wrong and slightly upsetting.
 */
export function compareTonnage(
  totalKg: number,
  objects: readonly ComparisonObject[]
): TonnageComparison | null {
  if (!Number.isFinite(totalKg) || totalKg <= 0) return null;

  let heaviest: ComparisonObject | null = null;

  for (const candidate of objects) {
    // A row with a nonsense mass is skipped rather than trusted. The CHECK on
    // the column says mass_kg > 0, but this function is also handed literals by
    // its tests and, one day, by whatever else reads the table.
    if (!Number.isFinite(candidate.massKg) || candidate.massKg <= 0) continue;
    if (candidate.massKg > totalKg) continue;
    if (heaviest === null || candidate.massKg > heaviest.massKg) heaviest = candidate;
  }

  if (heaviest === null) return null;

  /*
   * `count` cannot come out below 1: `massKg <= totalKg` is the filter above,
   * so the true quotient is at least 1 and IEEE-754 division is correctly
   * rounded, which cannot land under it. Asserted as a property rather than
   * defended with a Math.max, because a clamp there would be a branch no test
   * could ever reach and coverage would quietly stop meaning anything.
   */
  return { object: heaviest, count: Math.floor(totalKg / heaviest.massKg) };
}
