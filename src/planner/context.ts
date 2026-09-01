/**
 * Turns a user's history and candidate list into the two things phase 2 needs:
 * what the model is shown (`PlannerInput`) and what the rules measure against
 * (`RuleContext`).
 *
 * INVARIANT: every number here comes out of `src/metrics/` — CLAUDE.md #1. This
 *            file arranges figures; it does not derive them. The one exception
 *            is arithmetic *over* metric outputs (a mean of weekly tonnages),
 *            which is why that lives in a named, tested helper rather than
 *            inline in a prompt builder.
 *
 * Pure over plain shapes, like the metrics engine itself — the database read is
 * the caller's job, so this is testable without one.
 */
import { acwr, acwrBand, DEFAULT_CHRONIC_DAYS } from '../metrics/acwr';
import { adherence } from '../metrics/adherence';
import { addDays, startOfWeek } from '../metrics/dates';
import { exerciseBests } from '../metrics/pr';
import { tonnageByWeek } from '../metrics/tonnage';
import type { LocalDate, SetRecord, WorkoutRecord } from '../metrics/types';
import type { RuleCandidate, RuleContext } from './rules';
import type { CandidateSummary, MetricsSummary, PlannerInput, TrainingGoal } from './schema';

/** One candidate exercise, as both the model and the rules need it. */
export interface ContextCandidate {
  id: string;
  slug: string;
  name: string;
  primaryMuscle: string;
  movementPattern: string | null;
  equipment: { slug: string; maxLoadKg: number | null }[];
}

export interface ContextInput {
  goal: TrainingGoal;
  daysPerWeek: number;
  blockWeeks: number;
  injuredJoints: string[];
  asOf: LocalDate;
  workouts: readonly WorkoutRecord[];
  sets: readonly SetRecord[];
  candidates: readonly ContextCandidate[];
  /** How many candidates to show the model. The rules always see all of them. */
  candidateLimit?: number;
}

/**
 * WHY the model sees a trimmed list while the rules see the whole one: 873
 * exercises is far more prompt than a four-week block needs, and the list is
 * the largest dynamic part of the request. Trimming what is *shown* is a cost
 * decision; trimming what is *checked* would be a correctness bug, because a
 * slug the model legitimately picked must still resolve.
 *
 * AI-NOTE: it follows that this limit can be tuned freely for cost, but
 *          `RuleContext.candidates` must never be given the trimmed list.
 */
export const DEFAULT_CANDIDATE_LIMIT = 120;

const ADHERENCE_WINDOW_DAYS = 28;

/** Mean weekly tonnage over the chronic window. Null when history is too short. */
export function chronicWeeklyTonnage(sets: readonly SetRecord[], asOf: LocalDate): number | null {
  const weeks = DEFAULT_CHRONIC_DAYS / 7;
  const firstWeek = startOfWeek(addDays(asOf, -(DEFAULT_CHRONIC_DAYS - 1)));
  const byWeek = tonnageByWeek(sets);

  const earliest = [...byWeek.keys()][0];
  // Mirrors acwr()'s requireFullWindow: with two weeks of history the "chronic"
  // mean is just the acute one at longer range, and reporting it is worse than
  // reporting nothing.
  if (earliest === undefined || earliest > firstWeek) return null;

  let total = 0;
  for (const [week, tonnage] of byWeek) {
    if (week >= firstWeek && week <= asOf) total += tonnage;
  }
  return total / weeks;
}

/** The most recent week that has any work in it. Zero when there is none. */
export function baselineWeeklyTonnage(sets: readonly SetRecord[]): number {
  const byWeek = [...tonnageByWeek(sets).values()];
  return byWeek[byWeek.length - 1] ?? 0;
}

function toRuleCandidate(candidate: ContextCandidate): RuleCandidate {
  return {
    slug: candidate.slug,
    name: candidate.name,
    primaryMuscle: candidate.primaryMuscle,
    movementPattern: candidate.movementPattern,
    equipment: candidate.equipment,
  };
}

function toSummary(candidate: ContextCandidate): CandidateSummary {
  return {
    slug: candidate.slug,
    name: candidate.name,
    primary_muscle: candidate.primaryMuscle,
    movement_pattern: candidate.movementPattern,
    equipment: candidate.equipment.map((e) => ({ slug: e.slug, max_load_kg: e.maxLoadKg })),
  };
}

export function buildMetricsSummary(input: ContextInput): MetricsSummary {
  const { sets, workouts, asOf } = input;

  const byWeek = tonnageByWeek(sets);
  const ratio = acwr(sets, asOf);
  const bests = exerciseBests(sets);
  const slugById = new Map(input.candidates.map((c) => [c.id, c.slug]));

  const completed = workouts.filter((w) => w.status === 'completed').length;
  const weeksOfHistory = byWeek.size;

  return {
    as_of: asOf,
    weeks_of_history: weeksOfHistory,
    // Rounded for the prompt only. Nothing downstream computes from this.
    sessions_per_week:
      weeksOfHistory === 0 ? 0 : Math.round((completed / weeksOfHistory) * 10) / 10,
    adherence_rate: adherence(workouts, {
      start: addDays(asOf, -(ADHERENCE_WINDOW_DAYS - 1)),
      end: asOf,
    }).rate,
    weekly_tonnage_kg: [...byWeek].map(([week_start, tonnage_kg]) => ({
      week_start,
      tonnage_kg: Math.round(tonnage_kg),
    })),
    acwr: ratio.ratio === null ? null : Math.round(ratio.ratio * 100) / 100,
    acwr_band: acwrBand(ratio.ratio),
    best_e1rm_kg: [...bests.values()]
      .flatMap((best) => {
        const slug = slugById.get(best.exerciseId);
        if (slug === undefined || best.bestE1rm === null) return [];
        return [{ exercise_slug: slug, e1rm_kg: Math.round(best.bestE1rm * 10) / 10 }];
      })
      // Heaviest first: if the list is ever trimmed, the main lifts survive.
      .sort((a, b) => b.e1rm_kg - a.e1rm_kg),
  };
}

export function buildPlannerContext(input: ContextInput): {
  plannerInput: PlannerInput;
  ruleContext: RuleContext;
} {
  const limit = input.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;

  return {
    plannerInput: {
      goal: input.goal,
      days_per_week: input.daysPerWeek,
      block_weeks: input.blockWeeks,
      injured_joints: input.injuredJoints,
      metrics: buildMetricsSummary(input),
      candidates: input.candidates.slice(0, limit).map(toSummary),
      prior_rejections: [],
    },
    ruleContext: {
      // Deliberately the full list, never the trimmed one — see the AI-NOTE
      // on DEFAULT_CANDIDATE_LIMIT.
      candidates: input.candidates.map(toRuleCandidate),
      injuredJoints: input.injuredJoints,
      baselineWeeklyTonnageKg: baselineWeeklyTonnage(input.sets),
      chronicWeeklyTonnageKg: chronicWeeklyTonnage(input.sets, input.asOf),
    },
  };
}
