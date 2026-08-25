/**
 * Estimated one-rep max.
 *
 * INVARIANT: deterministic code computes this, never a model — CLAUDE.md #1.
 * The coach will read this number out loud; it has to be arithmetic, not a
 * plausible-sounding guess.
 */
import type { SetRecord } from './types';

/**
 * WHY: Epley is linear in reps and drifts badly as reps climb — at 20 reps it
 *      claims a 1.67x multiplier, which overstates a real max by a wide margin
 *      for most lifters. PLAN.md specifies Epley, so the formula stays; the cap
 *      is where its honesty ends.
 * AI-NOTE: if a set beyond this range ever needs an estimate, add a second
 *          formula (Brzycki, Lombardi) as a named alternative rather than
 *          raising this cap — the cap is the point.
 */
export const EPLEY_MAX_REPS = 12;

/**
 * Returns null rather than a number the caller would have to know to distrust.
 *
 * Null cases: no load (bodyweight work has no meaningful 1RM in kilograms),
 * no reps, or a rep count outside the range where Epley holds.
 */
export function epleyE1rm(weightKg: number | null, reps: number | null): number | null {
  if (weightKg === null || reps === null) return null;
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return null;
  if (weightKg <= 0 || reps < 1) return null;
  if (reps > EPLEY_MAX_REPS) return null;

  // A single at weight W is a measured max, not an estimate.
  if (reps === 1) return weightKg;

  return weightKg * (1 + reps / 30);
}

export function setE1rm(set: SetRecord): number | null {
  // WHY: warmups are excluded everywhere in this engine. A heavy-looking warmup
  //      single would otherwise register as a PR.
  if (set.isWarmup) return null;
  return epleyE1rm(set.weightKg, set.reps);
}

/** The best estimate across a group of sets, or null when none qualify. */
export function bestE1rm(sets: readonly SetRecord[]): number | null {
  let best: number | null = null;
  for (const set of sets) {
    const estimate = setE1rm(set);
    if (estimate !== null && (best === null || estimate > best)) best = estimate;
  }
  return best;
}
