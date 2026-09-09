/**
 * The calorie target, and every number that produces it.
 *
 * INVARIANT: the LLM never computes a number — CLAUDE.md #1. Nothing in this
 *            file is reachable from a model, and the diet stage is never given
 *            any of these figures — ADR 0024 §1.
 *
 * INVARIANT: diet outputs are clamped in code and no prompt, persona or user
 *            request can move the floor — CLAUDE.md #6. The clamp is here, it
 *            runs before a model is called, and its result is rendered by code.
 *
 * INVARIANT: kilograms and centimetres — CLAUDE.md #8.
 * INVARIANT: age is a calendar question, asked against the user's local date —
 *            CLAUDE.md #9. `today` is supplied; nothing here reads a clock.
 *
 * The contract is `docs/specs/diet.md` and it is authoritative. If behaviour and
 * spec disagree, one of them is a bug — decide which, then change both.
 *
 * Pure over plain shapes, like `src/metrics/`: no database, no clock, no DOM.
 */
import type { LocalDate } from '../metrics/types';
import { MAX_BODYWEIGHT_KG, MAX_HEIGHT_CM, type Sex } from './biometrics';

export const DIET_GOALS = ['cut', 'maintain', 'gain'] as const;
export type DietGoal = (typeof DIET_GOALS)[number];

export const ACTIVITY_BANDS = ['sedentary', 'light', 'moderate', 'high', 'very high'] as const;
export type ActivityBand = (typeof ACTIVITY_BANDS)[number];

/** Nobody is prescribed a target. See `computeEnergy` for what happens instead. */
export const MIN_AGE_YEARS = 18;

/**
 * The floor, and it is the whole safety property of this feature.
 *
 * `max(BMR, 1200)`: never prescribe below resting metabolic rate, and never
 * below 1,200 kcal whatever the equation says.
 *
 * AI-NOTE: 1,200 is a heuristic for adults and NOT a clinical standard — ADR
 *          0024's does-not-guarantee table says so, and that honesty is part of
 *          the artifact. Do not describe it as a medically safe minimum.
 */
export const ABSOLUTE_FLOOR_KCAL = 1200;

/**
 * Above this, the inputs are wrong rather than the person unusual.
 *
 * WHY it exists: the columns admit 9,999.99 kg and 9,999.9 cm — together a BMR
 * near 162,000 kcal — and even after this PR's bounds a mistyped 300 cm against
 * 900 kg produces five figures. A target that needs the ceiling is a data-entry
 * error, so it is refused rather than clamped and shown. The clamp still applies
 * it, because an invariant asserted in one place and enforced in another is an
 * invariant with a gap in it.
 */
export const TARGET_CEILING_KCAL = 6000;

/** Bounds on the adjustment, as fractions of TDEE. */
export const MAX_DEFICIT_FRACTION = 0.2;
export const MAX_SURPLUS_FRACTION = 0.15;

/** Grams of protein per kilogram of bodyweight. */
export const PROTEIN_G_PER_KG = 1.8;

/**
 * Mifflin–St Jeor's sex term.
 *
 * The two constants are 166 kcal apart. `unspecified` takes the HIGHER of them,
 * so the unavoidable error lands on the side of more food — ADR 0024 §3. Wrong
 * in a fixed, explainable direction, the same reasoning `src/metrics/tonnage.ts`
 * gives for counting bodyweight lifts as zero.
 */
const SEX_CONSTANT: Record<Sex, number> = {
  male: 5,
  female: -161,
  unspecified: 5,
};

/**
 * The standard multiplier bands, read off sessions per week.
 *
 * INVARIANT: measured, never self-reported — ADR 0024 §4. The count comes from
 *            `coachFacts().sessions_last_28_days`, which the chat already
 *            computes; this file does not recount it.
 *
 * Ordered high to low so the first match wins and the boundaries read as the
 * spec writes them.
 */
const ACTIVITY_TIERS: ReadonlyArray<{ from: number; factor: number; band: ActivityBand }> = [
  { from: 7, factor: 1.9, band: 'very high' },
  { from: 5, factor: 1.725, band: 'high' },
  { from: 3, factor: 1.55, band: 'moderate' },
  { from: 0.5, factor: 1.375, band: 'light' },
  { from: 0, factor: 1.2, band: 'sedentary' },
];

export type BiometricField = 'bodyweightKg' | 'heightCm' | 'birthDate' | 'sex';

export interface EnergyInput {
  /** INVARIANT: the user's local date, never a server date — CLAUDE.md #9. */
  today: LocalDate;
  bodyweightKg: number | null;
  heightCm: number | null;
  birthDate: LocalDate | null;
  sex: Sex | null;
  /** From `coachFacts()`. Whole sessions in the trailing 28 days. */
  sessionsLast28Days: number;
  /** Unvalidated on purpose: anything unrecognised becomes `maintain`. */
  goal: string;
}

export interface EnergyTarget {
  kind: 'ok';
  asOf: LocalDate;
  /** Whole kcal. Every figure below is an integer, and that is load-bearing. */
  bmrKcal: number;
  tdeeKcal: number;
  targetKcal: number;
  floorKcal: number;
  proteinG: number;
  sessionsPerWeek: number;
  activityBand: ActivityBand;
  goal: DietGoal;
  isDeficit: boolean;
  /** True when the clamp decided the target rather than the goal. */
  floorReached: boolean;
}

export type EnergyResult =
  | EnergyTarget
  | { kind: 'missing-biometric'; missing: BiometricField }
  | { kind: 'under-18'; ageYears: number }
  | {
      kind: 'implausible-input';
      reason: 'non-finite' | 'unreal-date' | 'no-resting-rate' | 'ceiling';
    };

/**
 * Whole years from `birthDate` to `today`, both the user's local dates.
 *
 * String comparison on zero-padded ISO dates orders them correctly, which is the
 * same property `isFutureBirthDate` relies on.
 *
 * WHY this and not a day count divided by 365.25: a birthday is a calendar
 * event, and dividing gets the boundary wrong for anybody born on 29 February
 * in a way nobody would ever notice. Here that person's birthday falls on 1
 * March in a non-leap year — `2027-02-29` sorts after `2027-02-28`, so the age
 * increments a day late rather than early. Late is the safe direction for a gate
 * that withholds a calorie target from a minor.
 */
export function ageOn(birthDate: LocalDate, today: LocalDate): number {
  const birthdayThisYear = `${today.slice(0, 4)}${birthDate.slice(4)}`;
  const years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  return today < birthdayThisYear ? years - 1 : years;
}

/** Resting metabolic rate, in kcal per day. */
export function mifflinStJeor(
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sex: Sex
): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears + SEX_CONSTANT[sex];
}

export function activityTier(sessionsPerWeek: number): { factor: number; band: ActivityBand } {
  // Non-null: the last tier starts at 0 and sessionsPerWeek is never negative.
  const tier = ACTIVITY_TIERS.find((candidate) => sessionsPerWeek >= candidate.from)!;
  return { factor: tier.factor, band: tier.band };
}

/**
 * The calorie delta for a goal, bounded in both directions.
 *
 * INVARIANT: an unrecognised goal is `maintain`, never a deficit — ADR 0024 §3.
 *            The goal is the only user-controlled value entering this
 *            computation, and a `<select>` is not a gate.
 */
export function boundedAdjustment(tdeeKcal: number, goal: string): number {
  if (goal === 'cut') return -tdeeKcal * MAX_DEFICIT_FRACTION;
  if (goal === 'gain') return tdeeKcal * MAX_SURPLUS_FRACTION;
  return 0;
}

/** `maintain` for anything the enum does not hold. */
export function normaliseGoal(goal: string): DietGoal {
  return (DIET_GOALS as readonly string[]).includes(goal) ? (goal as DietGoal) : 'maintain';
}

export function proteinTarget(weightKg: number): number {
  return Math.round(weightKg * PROTEIN_G_PER_KG);
}

/** Every numeric input, named, so a refusal can say which one was unusable. */
function firstMissing(input: EnergyInput): BiometricField | null {
  if (input.bodyweightKg === null) return 'bodyweightKg';
  if (input.heightCm === null) return 'heightCm';
  if (input.birthDate === null) return 'birthDate';
  if (input.sex === null) return 'sex';
  return null;
}

/**
 * The target, or a refusal that says why.
 *
 * INVARIANT: this never returns a partial number. Every branch either produces
 *            a complete, clamped `EnergyTarget` or refuses — CLAUDE.md #6, and
 *            `docs/specs/mobile-interface.md`'s rule that every state renders
 *            something.
 */
export function computeEnergy(input: EnergyInput): EnergyResult {
  const missing = firstMissing(input);
  if (missing !== null) return { kind: 'missing-biometric', missing };

  const weightKg = input.bodyweightKg as number;
  const heightCm = input.heightCm as number;
  const birthDate = input.birthDate as LocalDate;
  const sex = input.sex as Sex;

  /*
   * INVARIANT: refused BEFORE the first multiplication — ADR 0024 §3.
   *
   * `'NaN'::numeric > 0` is TRUE in PostgreSQL and PostgREST casts the JSON
   * string "NaN" into a numeric column, so a NaN can reach this function from a
   * row written before 20260909120000 added bounds, or by any path that skips
   * them. NaN propagates through Math.min and Math.max, so the clamp does not
   * stop it, and a NaN target is NOT null — it would sail past every other
   * branch here and render as a prescription.
   *
   * The magnitudes are re-checked for the same reason: this file does not trust
   * the column, because the column cannot see every path.
   */
  const finite =
    Number.isFinite(weightKg) &&
    Number.isFinite(heightCm) &&
    Number.isFinite(input.sessionsLast28Days);
  const inRange =
    weightKg > 0 && weightKg < MAX_BODYWEIGHT_KG && heightCm > 0 && heightCm < MAX_HEIGHT_CM;
  if (!finite || !inRange) return { kind: 'implausible-input', reason: 'non-finite' };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.today)) {
    return { kind: 'implausible-input', reason: 'unreal-date' };
  }

  const ageYears = ageOn(birthDate, input.today);
  if (ageYears < MIN_AGE_YEARS) return { kind: 'under-18', ageYears };

  const sessionsPerWeek = Math.max(0, input.sessionsLast28Days) / 4;
  const { factor, band } = activityTier(sessionsPerWeek);

  /*
   * Rounded HERE, once, and every figure below is derived from the rounded
   * values rather than from the raw ones.
   *
   * WHY it matters: the floor is `max(bmr, 1200)`, and a target rounded
   * independently of the bmr it is compared against can land a fraction of a
   * kcal below its own floor — the property test asserting `target >= floor`
   * would then fail on inputs nobody would ever think to try. `src/gamification/
   * level.ts` carries the same lesson about rounding per step rather than at the
   * end of a sum.
   */
  const bmrKcal = Math.round(mifflinStJeor(weightKg, heightCm, ageYears, sex));

  /*
   * FOUND BY THE SWEEP, on its first run, and it is the reason the sweep is a
   * sweep: Mifflin–St Jeor goes NEGATIVE for combinations every column admits.
   * One kilogram at one centimetre, aged 120, female: 10 + 6.25 − 600 − 161 =
   * −745 kcal.
   *
   * The floor still rescued the TARGET — it came out at 1,200 — which is
   * precisely why this needed catching. The clamp did its job and the surface
   * would have rendered "your resting burn is −745 kcal" beside it, a figure
   * that is not wrong by a little. A person whose equation returns nothing
   * positive is not a person the equation describes, so it is refused rather
   * than clamped into looking sane.
   */
  if (bmrKcal <= 0) return { kind: 'implausible-input', reason: 'no-resting-rate' };

  const tdeeKcal = Math.round(bmrKcal * factor);

  const goal = normaliseGoal(input.goal);
  const rawTarget = Math.round(tdeeKcal + boundedAdjustment(tdeeKcal, goal));
  const floorKcal = Math.max(bmrKcal, ABSOLUTE_FLOOR_KCAL);

  // A target that needs the ceiling is a mistyped input, not a diet — and so is
  // a floor above it, which is the same fault reached from the other side.
  if (rawTarget >= TARGET_CEILING_KCAL || floorKcal >= TARGET_CEILING_KCAL) {
    return { kind: 'implausible-input', reason: 'ceiling' };
  }

  // INVARIANT: the clamp, and the only place `targetKcal` is assigned.
  const targetKcal = Math.min(Math.max(rawTarget, floorKcal), TARGET_CEILING_KCAL);

  return {
    kind: 'ok',
    asOf: input.today,
    bmrKcal,
    tdeeKcal,
    targetKcal,
    floorKcal,
    proteinG: proteinTarget(weightKg),
    sessionsPerWeek,
    activityBand: band,
    goal,
    isDeficit: targetKcal < tdeeKcal,
    floorReached: rawTarget < floorKcal,
  };
}
