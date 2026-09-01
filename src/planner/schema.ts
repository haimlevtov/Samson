/**
 * The planner/critic boundary, as data.
 *
 * INVARIANT: Zod schemas are the single source of truth — CLAUDE.md conventions.
 *            The same schema generates the structured-output JSON schema sent
 *            upstream and validates what comes back. TS types are inferred, never
 *            hand-written alongside.
 *
 * INVARIANT: handoffs carry structure, never prose — ADR 0004. Every rejection
 *            that crosses a stage boundary is an array of tagged objects, so the
 *            receiving stage reads a field instead of guessing at a sentence.
 *
 * AI-NOTE: every object here is `z.strictObject`, deliberately. The gateway
 *          sends these with `strict: true`, which requires
 *          `additionalProperties: false` and every property present in
 *          `required`. A `.optional()` field silently breaks that contract at
 *          request time — use `.nullable()` instead, which emits an anyOf
 *          including null.
 *
 *          The provider is not named here on purpose:
 *          tests/unit/invariants.test.ts greps the whole tree for that word to
 *          enforce CLAUDE.md #2, and it cannot tell a comment from a fetch.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// What the planner is asked for
// ---------------------------------------------------------------------------

export const trainingGoalSchema = z.enum([
  'strength',
  'hypertrophy',
  'general-fitness',
  'return-to-training',
]);
export type TrainingGoal = z.infer<typeof trainingGoalSchema>;

/**
 * One prescribed group of identical sets — "3×5 at 60 kg" is one of these.
 *
 * WHY grouped rather than one object per set — ADR 0007, and it is measured
 * rather than argued: enumerating every set made a four-week block exceed
 * 16,000 output tokens without finishing, at $0.185 per failed attempt. A ramp
 * is still expressible as consecutive groups of `count: 1`.
 *
 * WHY `weight_kg` is nullable rather than absent for bodyweight work: tonnage
 * counts external load only (`src/metrics/tonnage.ts`), so an unloaded movement
 * genuinely has no weight rather than a weight of zero. Zero would be a claim.
 *
 * AI-NOTE: there is no `set_index`. Position in the array was already saying
 *          the same thing, and the indices are generated when a block is
 *          materialised into `sets` rows — the same job `insertSet()` does
 *          when logging.
 */
export const prescribedSetGroupSchema = z.strictObject({
  /** How many identical sets this group prescribes. */
  count: z.int().min(1).max(20),
  reps: z.int().min(1).max(50),
  // INVARIANT: kilograms are canonical — CLAUDE.md #8. Display converts, not this.
  weight_kg: z.number().min(0).max(500).nullable(),
  rpe: z.number().min(1).max(10).nullable(),
  rest_seconds: z.int().min(0).max(900),
});
export type PrescribedSetGroup = z.infer<typeof prescribedSetGroupSchema>;

/**
 * AI-NOTE: exercises are referenced by `slug`, not by uuid. The model copies
 *          this string verbatim from the candidate list, and a 36-character
 *          uuid is both expensive to emit and easy to corrupt by one character
 *          — which then looks like a hallucinated exercise rather than a typo.
 *          `equipment_available` in rules.ts resolves the slug against the
 *          candidate list and rejects anything that does not match.
 */
export const prescribedExerciseSchema = z.strictObject({
  exercise_slug: z.string().min(1).max(120),
  /**
   * Named `set_groups` and not `sets` on purpose — ADR 0007. Each entry is
   * `count` sets, so every tonnage calculation multiplies before it sums, and
   * a name that hid that would be exactly the stale naming CLAUDE.md's comment
   * rules exist to prevent.
   */
  set_groups: z.array(prescribedSetGroupSchema).min(1).max(6),
});
export type PrescribedExercise = z.infer<typeof prescribedExerciseSchema>;

export const plannedSessionSchema = z.strictObject({
  /** Position within the training week, not a weekday. Scheduling is the app's job. */
  day_index: z.int().min(0).max(6),
  focus: z.string().min(1).max(60),
  exercises: z.array(prescribedExerciseSchema).min(1).max(10),
});
export type PlannedSession = z.infer<typeof plannedSessionSchema>;

export const plannedWeekSchema = z.strictObject({
  week_number: z.int().min(1).max(12),
  /**
   * INVARIANT: rest is part of the plan — CLAUDE.md #4. A deload week is
   *            declared, not inferred from the numbers, so `deload_cadence` can
   *            check for one without second-guessing what the planner intended.
   */
  is_deload: z.boolean(),
  sessions: z.array(plannedSessionSchema).max(7),
});
export type PlannedWeek = z.infer<typeof plannedWeekSchema>;

export const trainingBlockSchema = z.strictObject({
  weeks: z.array(plannedWeekSchema).min(1).max(12),
  /** One paragraph, for the phase 3 persona layer to deliver. Never a number source. */
  rationale: z.string().min(1).max(800),
});
export type TrainingBlock = z.infer<typeof trainingBlockSchema>;

// ---------------------------------------------------------------------------
// What the model is shown
// ---------------------------------------------------------------------------

export const candidateSummarySchema = z.strictObject({
  slug: z.string(),
  name: z.string(),
  primary_muscle: z.string(),
  movement_pattern: z.string().nullable(),
  /** Owned equipment this movement uses, with any per-item ceiling in kg. */
  equipment: z.array(z.strictObject({ slug: z.string(), max_load_kg: z.number().nullable() })),
});
export type CandidateSummary = z.infer<typeof candidateSummarySchema>;

/**
 * The metrics half of the prompt.
 *
 * INVARIANT: every figure here was computed by `src/metrics/` — CLAUDE.md #1.
 *            The model reads these; it never derives them. If a planner prompt
 *            ever asks a model to work one out, that is the bug.
 */
export const metricsSummarySchema = z.strictObject({
  as_of: z.string(),
  weeks_of_history: z.int(),
  sessions_per_week: z.number(),
  adherence_rate: z.number().nullable(),
  weekly_tonnage_kg: z.array(z.strictObject({ week_start: z.string(), tonnage_kg: z.number() })),
  acwr: z.number().nullable(),
  acwr_band: z.enum(['unknown', 'low', 'sweet-spot', 'high', 'danger']),
  best_e1rm_kg: z.array(z.strictObject({ exercise_slug: z.string(), e1rm_kg: z.number() })),
});
export type MetricsSummary = z.infer<typeof metricsSummarySchema>;

export const plannerInputSchema = z.strictObject({
  goal: trainingGoalSchema,
  days_per_week: z.int().min(1).max(7),
  block_weeks: z.int().min(1).max(12),
  injured_joints: z.array(z.string()),
  metrics: metricsSummarySchema,
  candidates: z.array(candidateSummarySchema),
  /** Structured findings from the previous iteration. Empty on the first pass. */
  prior_rejections: z.array(
    z.strictObject({
      source: z.enum(['rules', 'critic']),
      code: z.string(),
      detail: z.string(),
      week_number: z.int().nullable(),
    })
  ),
});
export type PlannerInput = z.infer<typeof plannerInputSchema>;

// ---------------------------------------------------------------------------
// What the critic returns
// ---------------------------------------------------------------------------

/**
 * A closed vocabulary, deliberately.
 *
 * WHY: an open `reason: string` makes the critic's output unanalysable — thirty
 * runs produce thirty phrasings of four problems, and the phase report can only
 * say "the critic rejected things". Every code here names something the
 * deterministic rules provably cannot check, because it requires reading the
 * block against this person's history rather than against a number.
 *
 * AI-NOTE: do not add a code that a rule could enforce. That is the boundary in
 *          ADR 0004 — if it is a comparison against a number it belongs in
 *          rules.ts, where no model gets a vote.
 */
export const criticCodeSchema = z.enum([
  'unsuitable_for_experience',
  'poor_exercise_selection',
  'imbalanced_programming',
  'ignores_plateau',
  'resumes_too_heavy',
  'insufficient_recovery',
  'adherence_mismatch',
  'other',
]);
export type CriticCode = z.infer<typeof criticCodeSchema>;

export const criticReasonSchema = z.strictObject({
  code: criticCodeSchema,
  detail: z.string().min(1).max(400),
  /** `block` fails the plan. `warn` is recorded and does not. */
  severity: z.enum(['block', 'warn']),
  week_number: z.int().min(1).max(12).nullable(),
});
export type CriticReason = z.infer<typeof criticReasonSchema>;

export const criticVerdictSchema = z.strictObject({
  approved: z.boolean(),
  reasons: z.array(criticReasonSchema).max(10),
});
export type CriticVerdict = z.infer<typeof criticVerdictSchema>;

// ---------------------------------------------------------------------------
// Rejections — the one shape both sources share
// ---------------------------------------------------------------------------

export type RejectionSource = 'rules' | 'critic';

/**
 * INVARIANT: the two rejection sources are never conflated — PLAN.md phase 2.
 *            `source` is what keeps them apart in `plan_runs.rejections`, and
 *            it is the difference between "the planner prompt is weak" and
 *            "arithmetic is doing the job the critic was going to be trusted
 *            with". Those imply opposite next moves.
 */
export interface Rejection {
  source: RejectionSource;
  code: string;
  detail: string;
  weekNumber: number | null;
}
