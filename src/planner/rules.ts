/**
 * The deterministic floor under the planner.
 *
 * INVARIANT: the LLM never computes a number — CLAUDE.md #1. Every limit here is
 *            arithmetic over the plan, and it runs on every block regardless of
 *            what the critic model says.
 *
 * WHY code and not the critic's opinion: schema validation is a form check. A
 * block prescribing twenty sets of squats is schema-valid. A model asked to hold
 * a volume cap will usually hold it and will sometimes produce a fluent,
 * confident, well-formed block that does not — and no shape check tells the two
 * apart. The cap is arithmetic, so arithmetic enforces it.
 *
 * The contract is `docs/specs/planner-rules.md`, and it is authoritative: the
 * tests for this file were written from that document alone, without sight of
 * this code. If behaviour and spec disagree, one of them is a bug — decide
 * which, then change both.
 *
 * AI-NOTE: if a rule can be written as a comparison against a number it belongs
 *          here, where no model gets a vote. Only genuinely holistic judgement
 *          goes to the critic — see ADR 0004.
 */
import { ACWR_HIGH_RISK } from '../metrics/acwr';
import type { PlannedWeek, TrainingBlock } from './schema';

export type RuleCode =
  | 'weekly_volume_increase'
  | 'acwr_band'
  | 'deload_cadence'
  | 'equipment_available'
  | 'load_ceiling'
  | 'injured_joint';

/**
 * The binding quantity behind a finding, as a field rather than as a sentence.
 *
 * WHY this exists at all — ADR 0008: `detail` is prose for a human, and the
 * planner was being asked to parse "above the 30 kg ceiling" back into 30. That
 * is exactly the handoff ADR 0004 forbids everywhere else in this pipeline; the
 * rejection path was the last one still doing it.
 *
 * AI-NOTE: `comparison` is not decoration. `weekly_volume_increase` fails
 *          strictly above its cap while `acwr_band` fails AT its threshold, so
 *          a single "must not exceed" rendering would tell the planner that a
 *          block sitting exactly on the ACWR limit is acceptable. It is not.
 */
export interface RuleConstraint {
  kind:
    'max_weight_kg' | 'max_week_tonnage_kg' | 'deload_by_week' | 'unknown_slug' | 'forbidden_slug';
  comparison: 'at_most' | 'below' | 'excluded';
  /** The offending movement, where the finding is about one. */
  exerciseSlug: string | null;
  /** Null for the kinds where the slug itself is the finding. */
  limit: number | null;
}

export interface RuleFinding {
  code: RuleCode;
  detail: string;
  weekNumber: number | null;
  /** What the planner must actually do differently — see ADR 0008. */
  constraint: RuleConstraint;
}

export interface CandidateEquipment {
  slug: string;
  /** Null means this item imposes no ceiling. */
  maxLoadKg: number | null;
}

export interface RuleCandidate {
  slug: string;
  name: string;
  primaryMuscle: string;
  movementPattern: string | null;
  equipment: CandidateEquipment[];
}

export interface RuleContext {
  candidates: RuleCandidate[];
  injuredJoints: string[];
  /** The user's actual recent weekly tonnage in kg. Zero when there is no history. */
  baselineWeeklyTonnageKg: number;
  /** Mean weekly tonnage over the chronic window. Null when history is too short. */
  chronicWeeklyTonnageKg: number | null;
}

/**
 * WHY 10%: the most widely cited progression heuristic in the training
 * literature, and a convention rather than a fact — which is exactly why it is
 * a named export the phase report can cite and a future phase can tune, instead
 * of a literal buried in a comparison.
 */
export const MAX_WEEKLY_TONNAGE_INCREASE = 0.1;

export const DELOAD_REQUIRED_BY_WEEK = 5;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * INVARIANT: external load only — the same convention as src/metrics/tonnage.ts.
 *            A set with no weight contributes zero rather than an imputed
 *            bodyweight, so a prescribed block and a logged one are measured on
 *            the same scale and can be compared at all.
 */
export function weekPrescribedTonnage(week: PlannedWeek): number {
  let total = 0;
  for (const session of week.sessions) {
    for (const exercise of session.exercises) {
      for (const group of exercise.set_groups) {
        // MULTIPLY before summing: a group is `count` identical sets — ADR 0007.
        if (group.weight_kg !== null) total += group.weight_kg * group.reps * group.count;
      }
    }
  }
  return total;
}

/** Weeks in `week_number` order. Array position is not trusted to be the order. */
function orderedWeeks(block: TrainingBlock): PlannedWeek[] {
  return [...block.weeks].sort((a, b) => a.week_number - b.week_number);
}

function candidateIndex(context: RuleContext): Map<string, RuleCandidate> {
  return new Map(context.candidates.map((c) => [c.slug, c]));
}

/** Every (week, exercise slug) pair in the block, in week then session order. */
function* eachPrescribedExercise(
  block: TrainingBlock
): Generator<{ week: PlannedWeek; slug: string; weights: number[] }> {
  for (const week of orderedWeeks(block)) {
    for (const session of week.sessions) {
      for (const exercise of session.exercises) {
        const weights = exercise.set_groups
          .map((g) => g.weight_kg)
          .filter((w): w is number => w !== null);
        yield { week, slug: exercise.exercise_slug, weights };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 1. weekly_volume_increase
// ---------------------------------------------------------------------------

/**
 * WHY the baseline is the last non-deload week rather than simply the previous
 * week: coming back to normal volume after a deload would otherwise read as a
 * large spike every single time, and the rule would fire on correct programming.
 * A deload is a dip to recover from, not a new floor to progress from.
 */
export function weeklyVolumeIncrease(block: TrainingBlock, context: RuleContext): RuleFinding[] {
  const findings: RuleFinding[] = [];
  let baseline = context.baselineWeeklyTonnageKg;

  for (const week of orderedWeeks(block)) {
    if (week.is_deload) continue;

    const tonnage = weekPrescribedTonnage(week);

    // No meaningful ratio against zero, and a first-ever block has no history
    // it could be exceeding.
    if (baseline > 0) {
      const cap = baseline * (1 + MAX_WEEKLY_TONNAGE_INCREASE);
      if (tonnage > cap) {
        const pct = ((tonnage / baseline - 1) * 100).toFixed(1);
        findings.push({
          code: 'weekly_volume_increase',
          detail: `week ${week.week_number} prescribes ${tonnage.toFixed(0)} kg against a baseline of ${baseline.toFixed(0)} kg — a ${pct}% increase, over the ${MAX_WEEKLY_TONNAGE_INCREASE * 100}% cap`,
          weekNumber: week.week_number,
          constraint: {
            kind: 'max_week_tonnage_kg',
            comparison: 'at_most',
            exerciseSlug: null,
            limit: Math.floor(cap),
          },
        });
      }
    }

    baseline = tonnage;
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 2. acwr_band
// ---------------------------------------------------------------------------

/**
 * The jump from what the user is conditioned to, into week 1.
 *
 * AI-NOTE: the threshold is imported from src/metrics/acwr.ts rather than
 *          restated. If this file carried its own 1.5, the rule and the band the
 *          UI shows could drift apart and each would look correct in isolation.
 */
export function acwrBandRule(block: TrainingBlock, context: RuleContext): RuleFinding[] {
  const chronic = context.chronicWeeklyTonnageKg;
  // Mirrors acwr() returning null: too little history to mean anything, and
  // reporting a ratio then is worse than reporting nothing.
  if (chronic === null || chronic === 0) return [];

  const firstWeek = orderedWeeks(block).find((w) => w.week_number === 1);
  if (firstWeek === undefined) return [];

  const ratio = weekPrescribedTonnage(firstWeek) / chronic;
  if (ratio < ACWR_HIGH_RISK) return [];

  return [
    {
      code: 'acwr_band',
      detail: `week 1 prescribes ${ratio.toFixed(2)}× the chronic weekly mean of ${chronic.toFixed(0)} kg, at or above the ${ACWR_HIGH_RISK} danger threshold`,
      weekNumber: 1,
      constraint: {
        kind: 'max_week_tonnage_kg',
        comparison: 'below',
        exerciseSlug: null,
        limit: Math.ceil(chronic * ACWR_HIGH_RISK),
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 3. deload_cadence
// ---------------------------------------------------------------------------

export function deloadCadence(block: TrainingBlock): RuleFinding[] {
  if (block.weeks.length < DELOAD_REQUIRED_BY_WEEK) return [];

  const hasEarlyDeload = block.weeks.some(
    (w) => w.is_deload && w.week_number <= DELOAD_REQUIRED_BY_WEEK
  );
  if (hasEarlyDeload) return [];

  return [
    {
      code: 'deload_cadence',
      detail: `a ${block.weeks.length}-week block has no deload by week ${DELOAD_REQUIRED_BY_WEEK}`,
      // A property of the block as a whole, not of any single week.
      weekNumber: null,
      constraint: {
        kind: 'deload_by_week',
        comparison: 'at_most',
        exerciseSlug: null,
        limit: DELOAD_REQUIRED_BY_WEEK,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 4. equipment_available
// ---------------------------------------------------------------------------

/**
 * INVARIANT: the planner selects only from a pre-filtered candidate list —
 *            CLAUDE.md #5. The list is filtered in SQL before the model sees it,
 *            so a slug outside it is the model inventing an exercise. This is
 *            the check that catches it.
 */
export function equipmentAvailable(block: TrainingBlock, context: RuleContext): RuleFinding[] {
  const known = candidateIndex(context);
  const findings: RuleFinding[] = [];
  const reported = new Set<string>();

  for (const { week, slug } of eachPrescribedExercise(block)) {
    if (known.has(slug) || reported.has(slug)) continue;
    reported.add(slug);
    findings.push({
      code: 'equipment_available',
      detail: `"${slug}" is not in this user's candidate list`,
      weekNumber: week.week_number,
      constraint: {
        kind: 'unknown_slug',
        comparison: 'excluded',
        exerciseSlug: slug,
        limit: null,
      },
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 5. load_ceiling
// ---------------------------------------------------------------------------

/**
 * WHY the minimum of the non-null ceilings: if any implement the movement needs
 * is capped, that cap binds. Yossi's dumbbells stop at 30 kg regardless of what
 * else is in the room.
 */
function ceilingFor(candidate: RuleCandidate): number | null {
  const caps = candidate.equipment.map((e) => e.maxLoadKg).filter((c): c is number => c !== null);
  if (caps.length === 0) return null;
  return Math.min(...caps);
}

export function loadCeiling(block: TrainingBlock, context: RuleContext): RuleFinding[] {
  const known = candidateIndex(context);
  const findings: RuleFinding[] = [];
  const reported = new Set<string>();

  for (const { week, slug, weights } of eachPrescribedExercise(block)) {
    const candidate = known.get(slug);
    // An unknown slug is equipment_available's finding. Reporting it here too
    // would conflate two different problems in the rejection list.
    if (candidate === undefined) continue;

    const ceiling = ceilingFor(candidate);
    if (ceiling === null) continue;

    const heaviest = Math.max(0, ...weights);
    if (heaviest <= ceiling) continue;

    const key = `${slug}@${week.week_number}`;
    if (reported.has(key)) continue;
    reported.add(key);

    findings.push({
      code: 'load_ceiling',
      detail: `week ${week.week_number} prescribes ${heaviest} kg of ${candidate.name}, above the ${ceiling} kg ceiling on this user's equipment`,
      weekNumber: week.week_number,
      constraint: {
        kind: 'max_weight_kg',
        comparison: 'at_most',
        exerciseSlug: slug,
        limit: ceiling,
      },
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// 6. injured_joint
// ---------------------------------------------------------------------------

interface JointLoading {
  muscles: readonly string[];
  patterns: readonly string[];
}

/**
 * WHY muscles and patterns rather than one or the other: the catalogue's
 * `movement_pattern` is NULL on 79 of 873 exercises and collapses all pressing
 * into `push`, while `primary_muscle` cannot tell a squat from a leg extension.
 * Either signal alone leaves a gap a plan could walk through.
 *
 * AI-NOTE: the vocabularies are the catalogue's own — 17 primary muscles and
 *          the seven values `exercises.movement_pattern` accepts. A joint added
 *          here must use those exact strings; anything else silently matches
 *          nothing.
 */
export const JOINT_LOADING: Readonly<Record<string, JointLoading>> = {
  knee: { muscles: ['quadriceps', 'hamstrings', 'calves'], patterns: ['squat'] },
  hip: {
    muscles: ['glutes', 'hamstrings', 'adductors', 'abductors'],
    patterns: ['hinge', 'squat'],
  },
  'lower-back': { muscles: ['lower back'], patterns: ['hinge', 'carry'] },
  shoulder: { muscles: ['shoulders', 'chest', 'lats', 'traps'], patterns: [] },
  elbow: { muscles: ['biceps', 'triceps', 'forearms'], patterns: [] },
  wrist: { muscles: ['forearms'], patterns: ['carry'] },
  ankle: { muscles: ['calves'], patterns: ['squat'] },
} as const;

function loadsJoint(candidate: RuleCandidate, joint: string): boolean {
  const loading = JOINT_LOADING[joint];
  // An unrecognised joint matches nothing. Documented in the spec: it is not an
  // error, because a stray profile value must not fail every plan the user gets.
  if (loading === undefined) return false;

  if (loading.muscles.includes(candidate.primaryMuscle)) return true;
  return candidate.movementPattern !== null && loading.patterns.includes(candidate.movementPattern);
}

export function injuredJoint(block: TrainingBlock, context: RuleContext): RuleFinding[] {
  if (context.injuredJoints.length === 0) return [];

  const known = candidateIndex(context);
  const findings: RuleFinding[] = [];
  const reported = new Set<string>();

  for (const { week, slug } of eachPrescribedExercise(block)) {
    const candidate = known.get(slug);
    if (candidate === undefined) continue;

    const offending = context.injuredJoints.find((joint) => loadsJoint(candidate, joint));
    if (offending === undefined) continue;

    const key = `${slug}@${week.week_number}`;
    if (reported.has(key)) continue;
    reported.add(key);

    findings.push({
      code: 'injured_joint',
      detail: `week ${week.week_number} prescribes ${candidate.name}, which loads the ${offending}`,
      weekNumber: week.week_number,
      constraint: {
        kind: 'forbidden_slug',
        comparison: 'excluded',
        exerciseSlug: slug,
        limit: null,
      },
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------

/**
 * Every rule, in RuleCode declaration order.
 *
 * WHY it never short-circuits: one round trip reporting three problems is worth
 * three round trips reporting one each. The planner is being asked to revise,
 * and it can only fix what it was told about.
 */
export function checkRules(block: TrainingBlock, context: RuleContext): RuleFinding[] {
  return [
    ...weeklyVolumeIncrease(block, context),
    ...acwrBandRule(block, context),
    ...deloadCadence(block),
    ...equipmentAvailable(block, context),
    ...loadCeiling(block, context),
    ...injuredJoint(block, context),
  ];
}
