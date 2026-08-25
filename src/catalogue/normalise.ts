/**
 * Source exercise records → the shape `public.exercises` stores.
 *
 * INVARIANT: content lives in the database, not in code — CLAUDE.md #7. This
 *            file is the ingest pipeline, not the catalogue; the rows it
 *            produces are what ship.
 */
import { normaliseEquipment, type EquipmentSlug } from './equipment';

/** One record as published by the Free Exercise DB. */
export interface SourceExercise {
  id: string;
  name: string;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
}

/** Matches the columns of public.exercises plus its equipment join. */
export interface CatalogueExercise {
  slug: string;
  name: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  movementPattern: MovementPattern | null;
  isUnilateral: boolean;
  category: string;
  instructions: string | null;
  source: 'free-exercise-db';
  sourceId: string;
  equipment: EquipmentSlug;
}

/** The values `exercises.movement_pattern` accepts. */
export type MovementPattern = 'push' | 'pull' | 'squat' | 'hinge' | 'carry' | 'core' | 'isolation';

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Name fragments that identify a movement pattern the source cannot express.
 *
 * WHY curated rather than inferred: Free Exercise DB records `force` (push,
 * pull, static) and `mechanic` (compound, isolation). Neither distinguishes a
 * squat from an overhead press — both are "push, compound". The planner
 * programmes around exactly that distinction, so the ~30 lifts it actually
 * prescribes are labelled by hand and everything else is left alone.
 *
 * AI-NOTE: order is precedence, and squat must stay ahead of hinge. Olympic
 *          variants name two patterns at once — "Front Squat (Clean Grip)" is a
 *          squat that mentions the clean, and hinge-first mislabels it. A name
 *          containing 'squat' is a squat; the olympic keywords only decide names
 *          that do not.
 */
const PATTERN_KEYWORDS: ReadonlyArray<readonly [MovementPattern, readonly string[]]> = [
  ['squat', ['squat', 'lunge', 'step-up', 'step up', 'leg press', 'bulgarian', 'pistol', 'sissy']],
  [
    'hinge',
    [
      'deadlift',
      'romanian',
      'good morning',
      'hip thrust',
      'glute bridge',
      'swing',
      'rack pull',
      'clean',
      'snatch',
    ],
  ],
  ['carry', ['carry', "farmer's walk", 'farmers walk', 'suitcase', 'waiter walk', 'yoke']],
];

/**
 * WHY these produce `null` rather than a guess: 104 records are `force: static`
 * and 87 have no mechanic at all, mostly stretches. A wrong label is worse than
 * an absent one — the planner filters on this column, and a stretch mislabelled
 * 'push' becomes a candidate for a pressing day.
 */
export function deriveMovementPattern(source: SourceExercise): MovementPattern | null {
  // WHY name only, not the source id: Free Exercise DB ids are mangled copies of
  // the name and add nothing, while wger's are integers. Matching on the id
  // would make this behave differently per source for no benefit.
  const haystack = source.name.toLowerCase();

  for (const [pattern, keywords] of PATTERN_KEYWORDS) {
    if (keywords.some((k) => haystack.includes(k))) return pattern;
  }

  // Abdominal work is 'core' regardless of how the source classifies its force.
  if (source.primaryMuscles.includes('abdominals')) return 'core';

  if (source.mechanic === 'isolation') return 'isolation';
  if (source.force === 'push') return 'push';
  if (source.force === 'pull') return 'pull';

  return null;
}

const UNILATERAL_KEYWORDS = [
  'single-arm',
  'single arm',
  'one-arm',
  'one arm',
  'single-leg',
  'single leg',
  'one-leg',
  'alternate',
  'alternating',
  'lunge',
  'split squat',
  'bulgarian',
  'pistol',
  'suitcase',
  'step-up',
  'step up',
] as const;

export function deriveIsUnilateral(name: string): boolean {
  const lower = name.toLowerCase();
  return UNILATERAL_KEYWORDS.some((k) => lower.includes(k));
}

export function normaliseExercise(source: SourceExercise): CatalogueExercise {
  return {
    slug: slugify(source.name),
    name: source.name,
    // The schema requires a primary muscle; 'unspecified' beats dropping the row.
    primaryMuscle: source.primaryMuscles[0] ?? 'unspecified',
    secondaryMuscles: [...new Set(source.secondaryMuscles)],
    movementPattern: deriveMovementPattern(source),
    isUnilateral: deriveIsUnilateral(source.name),
    category: source.category,
    instructions: source.instructions.length > 0 ? source.instructions.join('\n\n') : null,
    source: 'free-exercise-db',
    sourceId: source.id,
    equipment: normaliseEquipment(source.equipment),
  };
}

/**
 * Normalises a whole source dump, dropping records that cannot make a valid row
 * and de-duplicating slugs.
 *
 * WHY slugs are de-duplicated here: `exercises` has a unique constraint on
 * (user_id, slug), so a collision would abort the seed halfway through. Two
 * source records with the same name are the same exercise as far as the
 * catalogue is concerned.
 */
export function normaliseAll(sources: readonly SourceExercise[]): {
  exercises: CatalogueExercise[];
  dropped: string[];
  duplicates: string[];
} {
  const bySlug = new Map<string, CatalogueExercise>();
  const dropped: string[] = [];
  const duplicates: string[] = [];

  for (const source of sources) {
    if (!source.name || source.name.trim() === '') {
      dropped.push(source.id ?? '(no id)');
      continue;
    }
    const exercise = normaliseExercise(source);
    if (exercise.slug === '') {
      dropped.push(source.id);
      continue;
    }
    if (bySlug.has(exercise.slug)) {
      duplicates.push(exercise.slug);
      continue;
    }
    bySlug.set(exercise.slug, exercise);
  }

  return {
    exercises: [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
    dropped,
    duplicates,
  };
}
