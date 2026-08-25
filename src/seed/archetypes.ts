/**
 * Synthetic training histories.
 *
 * WHY this is pure and lives in src/ rather than inside the seed script: PLAN.md
 * calls the seeder critical-path work that looks disposable. Without plausible
 * history there is nothing to develop the phase 2 planner against, because real
 * history takes months. Keeping generation separate from the database writes
 * means each archetype's defining property — the plateau actually plateaus, the
 * capped dumbbells are never exceeded — is asserted by a test rather than
 * eyeballed once and assumed.
 */
import { addDays, startOfWeek } from '../metrics/dates';
import type { LocalDate, WorkoutStatus } from '../metrics/types';
import { chance, jitter, randomInt, roundToPlate, type Rng } from './rng';

export interface ProgrammeEntry {
  exerciseSlug: string;
  /** Working sets, excluding warmups. */
  sets: number;
  reps: number;
  startingKg: number;
  /** Added per progressed week. Zero for bodyweight movements. */
  incrementKg: number;
  /** Which day of the training week this lift appears on, 0-indexed. */
  day: number;
}

export interface EquipmentGrant {
  slug: string;
  maxLoadKg?: number;
}

export interface Archetype {
  key: string;
  email: string;
  displayName: string;
  /** INVARIANT: history is generated in the user's local dates — CLAUDE.md #9. */
  timezone: string;
  summary: string;
  weeks: number;
  daysPerWeek: number;
  /** Probability a planned session is completed rather than skipped. */
  adherence: number;
  equipment: EquipmentGrant[];
  programme: ProgrammeEntry[];
  /** Inclusive, 1-indexed week range with no training at all. */
  layoff?: [number, number];
  /** Weeks after which load stops climbing. */
  plateauAfterWeek?: number;
  /** Hard ceiling on any single load, from capped equipment. */
  loadCeilingKg?: number;
}

export interface GeneratedSet {
  exerciseSlug: string;
  weightKg: number | null;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  restSeconds: number;
  setIndex: number;
}

export interface GeneratedWorkout {
  localDate: LocalDate;
  status: WorkoutStatus;
  notes: string | null;
  sets: GeneratedSet[];
}

const BARBELL_PROGRAMME: ProgrammeEntry[] = [
  {
    exerciseSlug: 'barbell-full-squat',
    sets: 3,
    reps: 5,
    startingKg: 60,
    incrementKg: 2.5,
    day: 0,
  },
  {
    exerciseSlug: 'barbell-bench-press-medium-grip',
    sets: 3,
    reps: 5,
    startingKg: 45,
    incrementKg: 1.25,
    day: 0,
  },
  {
    exerciseSlug: 'bent-over-barbell-row',
    sets: 3,
    reps: 8,
    startingKg: 40,
    incrementKg: 1.25,
    day: 0,
  },
  { exerciseSlug: 'barbell-deadlift', sets: 2, reps: 5, startingKg: 80, incrementKg: 2.5, day: 1 },
  {
    exerciseSlug: 'standing-military-press',
    sets: 3,
    reps: 5,
    startingKg: 30,
    incrementKg: 1.25,
    day: 1,
  },
  { exerciseSlug: 'pullups', sets: 3, reps: 6, startingKg: 0, incrementKg: 0, day: 1 },
  { exerciseSlug: 'romanian-deadlift', sets: 3, reps: 8, startingKg: 50, incrementKg: 2.5, day: 2 },
  {
    exerciseSlug: 'incline-dumbbell-press',
    sets: 3,
    reps: 10,
    startingKg: 20,
    incrementKg: 1.25,
    day: 2,
  },
  { exerciseSlug: 'plank', sets: 3, reps: 1, startingKg: 0, incrementKg: 0, day: 2 },
];

const HOME_GYM_PROGRAMME: ProgrammeEntry[] = [
  { exerciseSlug: 'dumbbell-squat', sets: 4, reps: 12, startingKg: 18, incrementKg: 2, day: 0 },
  {
    exerciseSlug: 'incline-dumbbell-press',
    sets: 4,
    reps: 10,
    startingKg: 16,
    incrementKg: 2,
    day: 0,
  },
  {
    exerciseSlug: 'bent-over-two-dumbbell-row',
    sets: 4,
    reps: 10,
    startingKg: 20,
    incrementKg: 2,
    day: 1,
  },
  {
    exerciseSlug: 'arnold-dumbbell-press',
    sets: 3,
    reps: 10,
    startingKg: 12,
    incrementKg: 2,
    day: 1,
  },
  { exerciseSlug: 'pullups', sets: 3, reps: 8, startingKg: 0, incrementKg: 0, day: 1 },
  {
    exerciseSlug: 'bodyweight-walking-lunge',
    sets: 3,
    reps: 12,
    startingKg: 0,
    incrementKg: 0,
    day: 2,
  },
  {
    exerciseSlug: 'alternate-hammer-curl',
    sets: 3,
    reps: 12,
    startingKg: 10,
    incrementKg: 2,
    day: 2,
  },
  { exerciseSlug: 'plank', sets: 3, reps: 1, startingKg: 0, incrementKg: 0, day: 2 },
];

/** The five cases PLAN.md names. */
export const ARCHETYPES: Archetype[] = [
  {
    key: 'beginner',
    email: 'beginner@samson.test',
    displayName: 'Noa (beginner)',
    timezone: 'Asia/Jerusalem',
    summary: 'Twelve weeks of clean linear progression. Everything works.',
    weeks: 12,
    daysPerWeek: 3,
    adherence: 0.92,
    equipment: [
      { slug: 'barbell' },
      { slug: 'dumbbell' },
      { slug: 'bodyweight' },
      { slug: 'machine' },
      { slug: 'cable-machine' },
    ],
    programme: BARBELL_PROGRAMME,
  },
  {
    key: 'plateaued',
    email: 'plateaued@samson.test',
    displayName: 'Dan (plateaued)',
    timezone: 'Europe/Berlin',
    summary: 'Trains hard and has not added weight in six weeks. The case the planner must notice.',
    weeks: 14,
    daysPerWeek: 4,
    adherence: 0.96,
    plateauAfterWeek: 6,
    equipment: [
      { slug: 'barbell' },
      { slug: 'dumbbell' },
      { slug: 'bodyweight' },
      { slug: 'cable-machine' },
    ],
    programme: BARBELL_PROGRAMME,
  },
  {
    key: 'returning',
    email: 'returning@samson.test',
    displayName: 'Maya (returning)',
    timezone: 'America/New_York',
    summary:
      'Trained, vanished for five weeks, came back lighter. Load must not resume where it stopped.',
    weeks: 16,
    daysPerWeek: 3,
    adherence: 0.85,
    layoff: [5, 9],
    equipment: [{ slug: 'barbell' }, { slug: 'dumbbell' }, { slug: 'bodyweight' }],
    programme: BARBELL_PROGRAMME,
  },
  {
    key: 'home-gym',
    email: 'homegym@samson.test',
    displayName: 'Yossi (home gym)',
    timezone: 'Asia/Jerusalem',
    summary: 'Dumbbells that stop at 30 kg, bands, and a pull-up bar. No barbell exists.',
    weeks: 12,
    daysPerWeek: 3,
    adherence: 0.88,
    // INVARIANT: equipment filtering happens in SQL — CLAUDE.md #5. This user is
    // the one that proves it: prescribe a barbell lift and it is plainly wrong.
    equipment: [
      { slug: 'dumbbell', maxLoadKg: 30 },
      { slug: 'resistance-band' },
      { slug: 'bodyweight' },
    ],
    loadCeilingKg: 30,
    programme: HOME_GYM_PROGRAMME,
  },
  {
    key: 'inconsistent',
    email: 'inconsistent@samson.test',
    displayName: 'Tom (inconsistent)',
    timezone: 'Europe/London',
    summary:
      'Plans four days a week and manages about half. Adherence, not volume, is his problem.',
    weeks: 12,
    daysPerWeek: 4,
    adherence: 0.5,
    equipment: [{ slug: 'barbell' }, { slug: 'dumbbell' }, { slug: 'bodyweight' }],
    programme: BARBELL_PROGRAMME,
  },
];

/**
 * Progression earned, in weeks-equivalent.
 *
 * WHY this takes earned weeks rather than the calendar week: an inconsistent
 * lifter who trains half the time must not get stronger at the same rate as one
 * who turns up. Driving load off the calendar produced a user who reached a
 * heavier squat than the diligent beginner while completing 19 sessions to the
 * beginner's 32 — visibly wrong, and exactly the kind of implausibility that
 * would let a broken phase 2 planner look correct.
 *
 * AI-NOTE: `earned` advances only on a completed session. Anything that changes
 *          how sessions are generated must keep that true, or every archetype
 *          collapses back onto the same curve.
 */
function progressedWeeks(archetype: Archetype, earned: number): number {
  const { plateauAfterWeek } = archetype;
  if (plateauAfterWeek !== undefined) return Math.min(earned, plateauAfterWeek);
  return earned;
}

/**
 * What a layoff costs.
 *
 * WHY a multiplier applied once on return rather than a gentler per-week decay:
 * the drop has to exceed the 2.5 kg plate rounding or it disappears entirely.
 * At 0.75 the returning user came back 1.25 kg lighter, which rounded straight
 * back to where they stopped and made the archetype indistinguishable from the
 * beginner.
 */
const DETRAINING_RETENTION = 0.35;

function workingLoad(
  archetype: Archetype,
  entry: ProgrammeEntry,
  earned: number,
  rng: Rng
): number {
  if (entry.startingKg === 0) return 0; // bodyweight movement
  const progressed = entry.startingKg + entry.incrementKg * progressedWeeks(archetype, earned);
  const withNoise = jitter(rng, progressed, 0.02);
  const rounded = roundToPlate(withNoise);
  // INVARIANT: capped equipment is a hard ceiling, not a suggestion.
  return archetype.loadCeilingKg ? Math.min(rounded, archetype.loadCeilingKg) : rounded;
}

function buildSets(
  archetype: Archetype,
  entries: readonly ProgrammeEntry[],
  earned: number,
  rng: Rng
): GeneratedSet[] {
  const sets: GeneratedSet[] = [];

  for (const entry of entries) {
    const load = workingLoad(archetype, entry, earned, rng);
    let index = 0;

    // A warmup or two on loaded barbell work, as anyone actually training would.
    if (load >= 40) {
      for (const fraction of [0.5, 0.75]) {
        sets.push({
          exerciseSlug: entry.exerciseSlug,
          weightKg: roundToPlate(load * fraction),
          reps: entry.reps,
          rpe: null,
          isWarmup: true,
          restSeconds: 60,
          setIndex: index++,
        });
      }
    }

    for (let s = 0; s < entry.sets; s++) {
      // Reps drift down across a hard set or two; RPE drifts up.
      const dropped = s > 0 && chance(rng, 0.25) ? 1 : 0;
      sets.push({
        exerciseSlug: entry.exerciseSlug,
        weightKg: load === 0 ? null : load,
        reps: Math.max(1, entry.reps - dropped),
        rpe: Math.min(10, 7 + s * 0.5 + (chance(rng, 0.3) ? 0.5 : 0)),
        isWarmup: false,
        restSeconds: entry.reps <= 5 ? randomInt(rng, 150, 240) : randomInt(rng, 60, 120),
        setIndex: index++,
      });
    }
  }

  return sets;
}

/**
 * Generates one archetype's history, ending on `endDate`.
 *
 * Sessions land on fixed weekdays so adherence has something to be measured
 * against: a missed day becomes a `skipped` workout with no sets, not an absence.
 * Without that row there is no denominator and adherence is unmeasurable.
 */
export function generateHistory(
  archetype: Archetype,
  endDate: LocalDate,
  rng: Rng
): GeneratedWorkout[] {
  const workouts: GeneratedWorkout[] = [];
  // Anchor to a Monday so training weeks line up with the ISO weeks that weekly
  // tonnage and the phase 4 XP ceiling both use.
  const lastWeekStart = startOfWeek(endDate);
  const firstWeekStart = addDays(lastWeekStart, -7 * (archetype.weeks - 1));

  // Spread sessions across the week rather than stacking them consecutively.
  const weekdayForDay = [0, 2, 4, 6];

  // Progression earned by turning up, in weeks-equivalent. Advances only on a
  // completed session, which is what separates the archetypes from each other.
  let earned = 0;
  let returnedFromLayoff = false;

  for (let week = 1; week <= archetype.weeks; week++) {
    const weekStart = addDays(firstWeekStart, (week - 1) * 7);
    const onLayoff =
      archetype.layoff !== undefined && week >= archetype.layoff[0] && week <= archetype.layoff[1];

    if (archetype.layoff && week > archetype.layoff[1] && !returnedFromLayoff) {
      earned *= DETRAINING_RETENTION;
      returnedFromLayoff = true;
    }

    for (let day = 0; day < archetype.daysPerWeek; day++) {
      const localDate = addDays(weekStart, weekdayForDay[day % weekdayForDay.length]!);
      if (localDate > endDate) continue;

      if (onLayoff) {
        workouts.push({
          localDate,
          status: 'skipped',
          notes: week === archetype.layoff![0] && day === 0 ? 'Travelling for work.' : null,
          sets: [],
        });
        continue;
      }

      const entries = archetype.programme.filter((e) => e.day === day % 3);
      if (entries.length === 0) continue;

      if (!chance(rng, archetype.adherence)) {
        workouts.push({ localDate, status: 'skipped', notes: null, sets: [] });
        continue;
      }

      workouts.push({
        localDate,
        status: 'completed',
        notes: null,
        sets: buildSets(archetype, entries, earned, rng),
      });
      earned += 1 / archetype.daysPerWeek;
    }

    // INVARIANT: a scheduled rest day maintains a streak — CLAUDE.md #4.
    // Seeding them means phase 4 has something to prove that against.
    if (!onLayoff) {
      workouts.push({ localDate: addDays(weekStart, 5), status: 'rest', notes: null, sets: [] });
    }
  }

  return workouts.filter((w) => w.localDate <= endDate);
}
