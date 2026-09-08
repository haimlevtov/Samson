/**
 * Cumulative tonnage, expressed as a thing rather than a figure.
 *
 * INVARIANT: deterministic code computes this, never a model — CLAUDE.md #1.
 *            The model is allowed to talk about the answer; it is not allowed
 *            to decide that 39,480 kg is "about a humpback whale".
 * INVARIANT: kilograms are canonical — CLAUDE.md #8. The objects carry mass in
 *            kg because the rest of the schema does; imperial is a display
 *            concern and never reaches this file.
 *
 * The objects themselves are rows in `tonnage_comparisons` — CLAUDE.md #7 —
 * so adding a whale is a migration. What lives here is the rule for picking
 * one, which is the part that has to be right every time.
 */

import type { ComparisonObject } from './types';

export interface TonnageComparison {
  object: ComparisonObject;
  /** How many of it. At least 1 whenever this is returned at all. */
  count: number;
}

/**
 * The heaviest object the user has actually passed, and how many of it.
 *
 * WHY heaviest-passed rather than closest-fitting — argued in ADR 0018: the
 * sentence has to shrink as the user grows. Picking whichever object divides
 * most neatly tells a five-year lifter at 3,000,000 kg that they have moved six
 * hundred and sixty-six thousand cats, which is arithmetically perfect and
 * reads as noise. At 240,000 kg this rule says one Statue of Liberty where the
 * same total is forty elephants or a thousand pianos; the ladder in the table
 * is built so the count stays small at every rung.
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
    /*
     * A row with a nonsense mass is skipped rather than trusted, and the guard
     * is `Number.isFinite` rather than `> 0` on purpose.
     *
     * FOUND IN REVIEW: the original `check (mass_kg > 0)` did NOT exclude NaN.
     * PostgreSQL orders NaN above every non-NaN numeric so that it can be
     * indexed, so `'NaN'::numeric > 0` is true — measured, not assumed. The
     * constraint was tightened to `> 0 and < 1e10` in migration 20260908100100,
     * which does exclude it, and this guard stays anyway: the function is also
     * handed literals by its tests and, one day, by whatever else reads the
     * table. Two gates for the same reason grants and policies are two gates.
     */
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
