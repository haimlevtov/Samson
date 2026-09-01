/**
 * The golden set: 30 planning situations built from real material.
 *
 * Five archetypes from `src/seed/archetypes.ts` crossed with six scenarios.
 * Histories come from `generateHistory`, so they are the same 8–16 weeks the
 * seeder puts in the database; the candidate lists come from the committed
 * 873-exercise catalogue snapshot, filtered by each archetype's equipment the
 * way `availableExercises` filters in SQL.
 *
 * WHY that matters: a golden set of hand-written fixtures proves the planner
 * works on hand-written fixtures. These are the actual distributions the app
 * will see — a plateau that really is flat for six weeks, a layoff that really
 * has a hole in it, a dumbbell ceiling that really binds.
 *
 * AI-NOTE: this file is offline by construction — snapshot plus PRNG, no
 *          database and no network — which is what lets the golden assertions
 *          run in CI with no secrets.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARCHETYPES, generateHistory, type Archetype } from '../../src/seed/archetypes';
import { mulberry32 } from '../../src/seed/rng';
import { PROGRAMMABLE_CATEGORIES } from '../../src/db/exercises';
import type { ContextCandidate } from '../../src/planner/context';
import type { SetRecord, WorkoutRecord } from '../../src/metrics/types';
import type { TrainingGoal } from '../../src/planner/schema';

interface SnapshotExercise {
  slug: string;
  name: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  movementPattern: string | null;
  category: string | null;
  equipment: string;
}

interface Snapshot {
  exercises: SnapshotExercise[];
}

/** The date every history ends on, so cases are reproducible run to run. */
export const GOLDEN_AS_OF = '2026-09-01';

/** Fixed, so "the golden set" means the same 30 cases in every session. */
const GOLDEN_SEED = 0x5a115f0;

let snapshot: Snapshot | null = null;

function catalogue(): SnapshotExercise[] {
  snapshot ??= JSON.parse(
    readFileSync(resolve(__dirname, '../../data/exercises.snapshot.json'), 'utf8')
  ) as Snapshot;
  return snapshot.exercises;
}

/**
 * The JS mirror of `availableExercises`' SQL filter: programmable categories,
 * equipment the user owns, ceilings attached.
 *
 * AI-NOTE: if the SQL filter in src/db/exercises.ts changes, this must change
 *          with it or the golden set stops describing what the planner will
 *          actually be handed. tests/db/candidates.test.ts covers the SQL side.
 */
export function candidatesFor(archetype: Archetype): ContextCandidate[] {
  const owned = new Map(archetype.equipment.map((e) => [e.slug, e.maxLoadKg ?? null]));

  return catalogue()
    .filter((e) => e.category !== null && PROGRAMMABLE_CATEGORIES.includes(e.category as never))
    .filter((e) => owned.has(e.equipment))
    .map((e) => ({
      id: `ex-${e.slug}`,
      slug: e.slug,
      name: e.name,
      primaryMuscle: e.primaryMuscle,
      movementPattern: e.movementPattern,
      equipment: [{ slug: e.equipment, maxLoadKg: owned.get(e.equipment) ?? null }],
    }));
}

/**
 * The vocabularies the whole catalogue uses, not just one user's candidates.
 *
 * WHY the distinction matters: all three `carry` exercises need `other`
 * equipment, which no archetype owns, so `carry` is catalogue-valid yet absent
 * from every candidate list. A vocabulary check against candidates would call
 * that a defect; a check against the catalogue correctly does not.
 */
export function catalogueVocabulary(): { muscles: Set<string>; patterns: Set<string> } {
  return {
    muscles: new Set(catalogue().map((e) => e.primaryMuscle)),
    patterns: new Set(
      catalogue()
        .map((e) => e.movementPattern)
        .filter((p): p is string => p !== null)
    ),
  };
}

export interface GoldenCase {
  id: string;
  archetype: Archetype;
  goal: TrainingGoal;
  daysPerWeek: number;
  blockWeeks: number;
  injuredJoints: string[];
  workouts: WorkoutRecord[];
  sets: SetRecord[];
  candidates: ContextCandidate[];
}

interface Scenario {
  key: string;
  goal: TrainingGoal;
  daysPerWeek: number;
  blockWeeks: number;
  injuredJoints: string[];
}

/**
 * Six scenarios, chosen so each stresses something different: the two injury
 * cases restrict opposite halves of the body, `return-to-training` on two days
 * is the sparsest block the rules must still admit, and the six-week blocks are
 * the only ones `deload_cadence` applies to at all.
 */
const SCENARIOS: Scenario[] = [
  { key: 'strength-3d', goal: 'strength', daysPerWeek: 3, blockWeeks: 4, injuredJoints: [] },
  { key: 'hypertrophy-4d', goal: 'hypertrophy', daysPerWeek: 4, blockWeeks: 6, injuredJoints: [] },
  {
    key: 'general-3d-knee',
    goal: 'general-fitness',
    daysPerWeek: 3,
    blockWeeks: 4,
    injuredJoints: ['knee'],
  },
  {
    key: 'return-2d',
    goal: 'return-to-training',
    daysPerWeek: 2,
    blockWeeks: 4,
    injuredJoints: [],
  },
  {
    key: 'strength-4d-shoulder',
    goal: 'strength',
    daysPerWeek: 4,
    blockWeeks: 6,
    injuredJoints: ['shoulder'],
  },
  {
    key: 'hypertrophy-3d-back',
    goal: 'hypertrophy',
    daysPerWeek: 3,
    blockWeeks: 6,
    injuredJoints: ['lower-back'],
  },
];

/**
 * Maps one archetype's generated history onto the plain metric shapes.
 *
 * Exercise ids are synthesised from slugs rather than looked up, because there
 * is no database here — `candidatesFor` uses the same `ex-<slug>` convention so
 * the two sides agree.
 */
function historyFor(archetype: Archetype): { workouts: WorkoutRecord[]; sets: SetRecord[] } {
  const rng = mulberry32(GOLDEN_SEED);
  const generated = generateHistory(archetype, GOLDEN_AS_OF, rng);

  const workouts: WorkoutRecord[] = [];
  const sets: SetRecord[] = [];

  generated.forEach((workout, index) => {
    workouts.push({
      id: `${archetype.key}-w${index}`,
      localDate: workout.localDate,
      status: workout.status,
    });
    for (const set of workout.sets) {
      sets.push({
        exerciseId: `ex-${set.exerciseSlug}`,
        weightKg: set.weightKg,
        reps: set.reps,
        rpe: set.rpe,
        isWarmup: set.isWarmup,
        localDate: workout.localDate,
      });
    }
  });

  return { workouts, sets };
}

/** All 30 cases: five archetypes × six scenarios. */
export function goldenCases(): GoldenCase[] {
  const cases: GoldenCase[] = [];

  for (const archetype of ARCHETYPES) {
    const { workouts, sets } = historyFor(archetype);
    const candidates = candidatesFor(archetype);

    for (const scenario of SCENARIOS) {
      cases.push({
        id: `${archetype.key}/${scenario.key}`,
        archetype,
        goal: scenario.goal,
        daysPerWeek: scenario.daysPerWeek,
        blockWeeks: scenario.blockWeeks,
        injuredJoints: scenario.injuredJoints,
        workouts,
        sets,
        candidates,
      });
    }
  }

  return cases;
}
