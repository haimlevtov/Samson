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

    const e1rm = setE1rm(set);
    if (e1rm === null) return;

    const best = bests.get(set.exerciseId)?.bestE1rm;
    // No history for this movement: a first entry has nothing to contradict, and
    // flagging it would make the very first log of every exercise suspicious.
    if (best === undefined || best === null || best <= 0) return;

    const ceiling = best * PLAUSIBLE_E1RM_MULTIPLE;
    if (e1rm <= ceiling) return;

    findings.push({
      code: 'exceeds_established_best',
      detail: `implies a ${e1rm.toFixed(1)} kg 1RM, over ${PLAUSIBLE_E1RM_MULTIPLE}× this user's best of ${best.toFixed(1)} kg`,
      setIndex,
    });
  });

  return findings;
}

/**
 * The sets that may count toward a reward.
 *
 * AI-NOTE: every reward path filters through this rather than reading `sets`
 *          directly. A second path that skipped it would be a second definition
 *          of what counts, and the two would drift.
 */
export function plausibleSets(
  sets: readonly SetRecord[],
  history: readonly SetRecord[]
): SetRecord[] {
  const flagged = new Set(checkPlausibility(sets, history).map((f) => f.setIndex));
  return sets.filter((_, index) => !flagged.has(index));
}
