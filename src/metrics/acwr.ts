/**
 * Acute:chronic workload ratio.
 *
 * A spike in recent training relative to what the body is accustomed to. The
 * phase 2 safety critic uses it as one of its volume guards.
 *
 * INVARIANT: deterministic code computes this, never a model — CLAUDE.md #1.
 */
import { addDays, eachDay } from './dates';
import { tonnageByDate } from './tonnage';
import type { LocalDate, SetRecord } from './types';
import type { TonnageOptions } from './tonnage';

export interface AcwrOptions extends TonnageOptions {
  acuteDays?: number;
  chronicDays?: number;
  /**
   * Require a full chronic window before reporting a ratio.
   * WHY on by default: with two weeks of history the "chronic" average is just
   * the acute one at longer range, and the ratio hovers near 1.0 no matter what
   * the user does. Reporting it then is worse than reporting nothing.
   */
  requireFullWindow?: boolean;
}

export const DEFAULT_ACUTE_DAYS = 7;
export const DEFAULT_CHRONIC_DAYS = 28;

/**
 * WHY these are exported rather than compared inline: they are a convention from
 * the sports-science literature, not a fact, and phase 2 needs to state which
 * band it enforced. Keeping them named makes that citable and tunable.
 */
export const ACWR_SWEET_SPOT = { low: 0.8, high: 1.3 } as const;
export const ACWR_HIGH_RISK = 1.5;

export interface AcwrResult {
  /** Null when there is not enough history to mean anything. */
  ratio: number | null;
  acuteMean: number;
  chronicMean: number;
  /** Days in the chronic window that actually have history behind them. */
  chronicDaysCovered: number;
}

/**
 * Uncoupled: the acute window is not subtracted from the chronic one.
 *
 * WHY uncoupled: it is the form most commonly reported, and the coupled variant
 * correlates the numerator with the denominator, which makes the ratio move for
 * arithmetic reasons rather than training ones.
 *
 * Rest days count as zero-load days inside both windows — that is the point of a
 * mean rather than a sum, and it is why a deload shows up here at all.
 */
export function acwr(
  sets: readonly SetRecord[],
  asOf: LocalDate,
  options: AcwrOptions = {}
): AcwrResult {
  const acuteDays = options.acuteDays ?? DEFAULT_ACUTE_DAYS;
  const chronicDays = options.chronicDays ?? DEFAULT_CHRONIC_DAYS;
  const requireFullWindow = options.requireFullWindow ?? true;

  const daily = tonnageByDate(sets, options);

  const mean = (from: LocalDate, days: number): number => {
    const total = eachDay(from, asOf).reduce((sum, day) => sum + (daily.get(day) ?? 0), 0);
    return total / days;
  };

  const acuteMean = mean(addDays(asOf, -(acuteDays - 1)), acuteDays);
  const chronicStart = addDays(asOf, -(chronicDays - 1));
  const chronicMean = mean(chronicStart, chronicDays);

  const earliest = [...daily.keys()][0];
  const chronicDaysCovered =
    earliest === undefined
      ? 0
      : Math.min(
          chronicDays,
          eachDay(earliest > chronicStart ? earliest : chronicStart, asOf).length
        );

  const insufficient = requireFullWindow && chronicDaysCovered < chronicDays;
  // A zero chronic mean would divide by zero; it also genuinely has no ratio.
  const ratio = insufficient || chronicMean === 0 ? null : acuteMean / chronicMean;

  return { ratio, acuteMean, chronicMean, chronicDaysCovered };
}

export function acwrBand(
  ratio: number | null
): 'unknown' | 'low' | 'sweet-spot' | 'high' | 'danger' {
  if (ratio === null) return 'unknown';
  if (ratio >= ACWR_HIGH_RISK) return 'danger';
  if (ratio > ACWR_SWEET_SPOT.high) return 'high';
  if (ratio < ACWR_SWEET_SPOT.low) return 'low';
  return 'sweet-spot';
}
