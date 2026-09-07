/**
 * Level — a reading of lifetime XP.
 *
 * INVARIANT: the LLM never computes a number — CLAUDE.md #1. A level is a
 *            number a user sees, so it is arithmetic with tests like every
 *            other one.
 *
 * INVARIANT: derived, never stored — ADR 0013. There is no level column, no
 *            level-up event and no timestamp. The same history always yields
 *            the same level, and tuning the curve migrates nothing.
 *
 * The contract is `docs/specs/xp-and-challenges.md` and it is authoritative.
 * If behaviour and spec disagree, one of them is a bug — decide which, then
 * change both.
 */

/** The cost of the first level-up. */
export const LEVEL_BASE_XP = 300;

/**
 * WHY 1.25 rather than 2: the weekly ceiling is 500, so a doubling curve puts
 * level 10 beyond a year of perfect adherence and a level nobody reaches is not
 * a reward. At 1.25 a consistent user is around level 10 after a season, which
 * is the horizon this app is built for.
 *
 * WHY geometric rather than linear: a linear curve makes level 30 exactly as
 * far from 29 as 2 is from 1, so the number stops meaning anything once the
 * early levels are behind you.
 */
export const LEVEL_GROWTH = 1.25;

export interface LevelProgress {
  /** 1 or above. */
  level: number;
  /** XP earned since this level began. Never negative. */
  intoLevel: number;
  /** What this level costs end to end. Always above zero. */
  span: number;
  /** XP still needed for the next level. Always above zero. */
  toNext: number;
}

/**
 * The cost of climbing FROM `level` to `level + 1`.
 *
 * AI-NOTE: rounded here, per step, and NOT at the end of a sum. `xpForLevel`
 *          adds these rounded steps, so the boundary property in the spec —
 *          levelForXp(xpForLevel(n)) === n — holds exactly. Rounding a
 *          closed-form geometric sum instead drifts by a few XP by level 10 and
 *          breaks it.
 */
function stepCost(level: number): number {
  return Math.round(LEVEL_BASE_XP * LEVEL_GROWTH ** (level - 1));
}

/**
 * Lifetime XP required to have reached `level`. `xpForLevel(1)` is 0.
 *
 * Levels below 1 return 0 rather than a negative total: there is no level 0, and
 * a caller asking for one is asking about the floor.
 */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let n = 1; n < level; n++) total += stepCost(n);
  return total;
}

/**
 * Sanitises a lifetime total.
 *
 * WHY it clamps rather than throws: lifetime XP is a sum over a ledger whose
 * amounts are non-negative by database constraint, so a negative total is
 * unreachable — and a progress bar is not the place to discover that it
 * happened anyway.
 */
function sane(lifetimeXp: number): number {
  return Number.isFinite(lifetimeXp) && lifetimeXp > 0 ? Math.floor(lifetimeXp) : 0;
}

/** The level a lifetime XP total earns. Never below 1. */
export function levelForXp(lifetimeXp: number): number {
  const xp = sane(lifetimeXp);

  let level = 1;
  let spent = 0;

  // Walks rather than solving for n, because the walk is over the same rounded
  // steps xpForLevel sums. A closed form would disagree with it at the edges.
  for (;;) {
    const next = spent + stepCost(level);
    if (next > xp) return level;
    spent = next;
    level += 1;
  }
}

/**
 * Everything the interface needs to draw a level, from one computation.
 *
 * WHY this returns the bar's numerator, denominator AND the remainder rather
 * than letting the caller subtract: a progress bar derived from one rule beside
 * a "420 XP to go" label derived from another is the classic way this ships
 * subtly wrong. The spec's agreement property — intoLevel + toNext === span —
 * is asserted against this function, so a caller that prints these fields
 * cannot disagree with itself.
 */
export function levelProgress(lifetimeXp: number): LevelProgress {
  const xp = sane(lifetimeXp);
  const level = levelForXp(xp);
  const floor = xpForLevel(level);
  const span = stepCost(level);

  return {
    level,
    intoLevel: xp - floor,
    span,
    toNext: floor + span - xp,
  };
}
