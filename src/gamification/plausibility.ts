/**
 * Plausibility — which logged sets are allowed to earn a reward.
 *
 * WHY this exists: the moment training earns XP, a typo becomes a payout. "200"
 * where the user meant "20" is an honest slip that unlocks a volume badge, and
 * a deliberate one is trivially easy. PLAN.md phase 4 asks for "plausibility
 * checks on submitted loads" for exactly this reason.
 *
 * WHAT IT DOES NOT DO: it does not delete anything, edit anything, or accuse
 * anyone. An implausible set stays in the user's log as their data — it is
 * excluded from *rewards* only. Silently rewriting somebody's training history
 * because an automated check disagreed with it would be far worse than a wrong
 * badge.
 *
 * Contract: `docs/specs/xp-and-challenges.md`.
 *
 * AI-NOTE: the reference is always the user's OWN history, never an absolute
 *          strength table. An absolute ceiling either insults a strong lifter or
 *          waves through a beginner's typo, and it cannot be tuned to do both.
 */
import { setE1rm } from '../metrics/e1rm';
import { exerciseBests } from '../metrics/pr';
import type { SetRecord } from '../metrics/types';

/**
 * WHY 1.5 and not something tighter: a genuine PR after a training block can be
 * a large jump, especially for a beginner whose first logged e1RM was set on a
 * cautious day. 1.5× the previous best is well past any honest single-session
 * improvement and still leaves real progress unchallenged.
 */
export const PLAUSIBLE_E1RM_MULTIPLE = 1.5;

/** Above this, a single set is a data-entry error rather than a set. */
export const MAX_PLAUSIBLE_REPS = 100;

/** Matches `prescribedSetGroupSchema`'s ceiling in the planner. */
export const MAX_PLAUSIBLE_WEIGHT_KG = 500;

export type ImplausibleCode = 'exceeds_established_best' | 'impossible_volume' | 'nonsense_value';

export interface PlausibilityFinding {
  code: ImplausibleCode;
  /** Names the offending number, so a human reading a log can see what happened. */
  detail: string;
  /** Index into the `sets` array passed in, not a database id. */
  setIndex: number;
}

/**
 * Findings for the supplied sets, measured against the supplied history.
 *
 * `history` should NOT include `sets` — a set compared against itself is always
 * exactly its own best and nothing is ever implausible.
 */
export function checkPlausibility(
  sets: readonly SetRecord[],
  history: readonly SetRecord[]
): PlausibilityFinding[] {
  const bests = exerciseBests(history);
  const findings: PlausibilityFinding[] = [];

  sets.forEach((set, setIndex) => {
    const { weightKg, reps } = set;

    if ((weightKg !== null && weightKg < 0) || (reps !== null && reps < 0)) {
      findings.push({
        code: 'nonsense_value',
        detail: `negative value: weight ${weightKg ?? 'null'} kg, ${reps ?? 'null'} reps`,
        setIndex,
      });
      return;
    }

    if (weightKg !== null && weightKg > MAX_PLAUSIBLE_WEIGHT_KG) {
      findings.push({
        code: 'nonsense_value',
        detail: `${weightKg} kg is above the ${MAX_PLAUSIBLE_WEIGHT_KG} kg maximum any set is accepted at`,
        setIndex,
      });
      return;
    }

    if (reps !== null && reps > MAX_PLAUSIBLE_REPS) {
      findings.push({
        code: 'impossible_volume',
        detail: `${reps} reps in one set is above the ${MAX_PLAUSIBLE_REPS} rep maximum`,
        setIndex,
      });
      return;
    }

    // Warmups are excluded from records upstream (`exerciseBests`), so judging
    // one against a record it could never have set would be incoherent.
    if (set.isWarmup) return;

    const bestsFor = bests.get(set.exerciseId);
    const e1rm = setE1rm(set);

    if (e1rm !== null) {
      const best = bestsFor?.bestE1rm;
      // No history for this movement: a first entry has nothing to contradict,
      // and flagging it would make the very first log of every exercise
      // suspicious.
      if (best === undefined || best === null || best <= 0) return;

      const ceiling = best * PLAUSIBLE_E1RM_MULTIPLE;
      if (e1rm <= ceiling) return;

      findings.push({
        code: 'exceeds_established_best',
        detail: `implies a ${e1rm.toFixed(1)} kg 1RM, over ${PLAUSIBLE_E1RM_MULTIPLE}× this user's best of ${best.toFixed(1)} kg`,
        setIndex,
      });
      return;
    }

    /*
     * No estimate available, which is not the same as nothing to check.
     *
     * WHY this branch exists: Epley is capped at EPLEY_MAX_REPS (12) and
     * `setE1rm` returns null past it, so every high-rep set used to leave this
     * function unjudged — including the exact typo the module exists to catch.
     * "400 kg × 15" cleared MAX_PLAUSIBLE_WEIGHT_KG and MAX_PLAUSIBLE_REPS, had
     * no e1RM to compare, and counted toward every challenge and achievement.
     *
     * The raw load is the honest fallback: it needs no formula, and moving more
     * than 1.5× the heaviest weight this user has ever handled for the movement
     * is implausible at any rep count — more so at high ones, not less.
     */
    const bestWeight = bestsFor?.bestWeightKg;
    if (weightKg === null || reps === null || reps <= 0) return;
    if (bestWeight === undefined || bestWeight === null || bestWeight <= 0) return;

    const weightCeiling = bestWeight * PLAUSIBLE_E1RM_MULTIPLE;
    if (weightKg <= weightCeiling) return;

    findings.push({
      code: 'exceeds_established_best',
      detail: `${weightKg} kg for ${reps} reps is over ${PLAUSIBLE_E1RM_MULTIPLE}× the heaviest ${bestWeight.toFixed(1)} kg this user has moved for this exercise`,
      setIndex,
    });
  });

  return findings;
}

/**
 * The sets that may count toward a reward.
 *
 * Two exclusions, for two different reasons. An implausible set is one this
 * module distrusts. A **warmup** is trusted completely and still earns nothing:
 * it is not the work the reward is for.
 *
 * WHY warmups are dropped here and not by `checkPlausibility`: a warmup is not
 * implausible, and emitting a finding for one would put "your empty-bar set is
 * suspicious" in front of a user who did nothing wrong. The rest of the engine
 * already draws this line — `setE1rm` (e1rm.ts) and `qualifies` (pr.ts) both
 * refuse warmups — and without it three empty-bar sets on three movements
 * completed a distinct-exercises challenge, which is the cheapest possible way
 * to finish one.
 *
 * AI-NOTE: every reward path IN TYPESCRIPT filters through this rather than
 *          reading `sets` directly, and should continue to. It is no longer the
 *          only reward path: the achievement predicates added in migration
 *          20260908090000 are SQL and cannot import this file, so they repeat
 *          MAX_PLAUSIBLE_WEIGHT_KG and MAX_PLAUSIBLE_REPS as literals — pinned
 *          by tests/db/achievements.test.ts, which reads them back out of the
 *          predicate text so the copies cannot drift silently.
 *
 *          Those predicates are DELIBERATELY weaker than this file: they cannot
 *          apply `exceeds_established_best`, which needs an e1RM, and a second
 *          definition of Epley in SQL is a worse problem than the gap. What
 *          bounds the gap is the prize — a badge pays a flat 75 XP once, where
 *          a challenge pays repeatedly. See docs/specs/xp-and-challenges.md.
 */
export function plausibleSets(
  sets: readonly SetRecord[],
  history: readonly SetRecord[]
): SetRecord[] {
  const flagged = new Set(checkPlausibility(sets, history).map((f) => f.setIndex));
  return sets.filter((set, index) => !flagged.has(index) && !set.isWarmup);
}
