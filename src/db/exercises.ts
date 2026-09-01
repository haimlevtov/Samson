/**
 * Candidate exercise selection.
 *
 * INVARIANT: the planner selects only from a pre-filtered candidate list, and
 *            equipment filtering happens in SQL before the model sees anything
 *            — CLAUDE.md #5.
 *
 * WHY this lives here rather than in the planner: a filter expressed in a prompt
 * can be argued with, and a filter applied to the model's *output* has already
 * wasted the tokens and given the coach a chance to promise something the user
 * cannot do. Filtering before the context window is built is the only version
 * that holds. Both the phase 1 exercise picker and the phase 2 planner call this
 * same function so there is one definition of "can this user do this".
 */
import type { Db } from './client';

/** Categories the app actually programmes. */
export const PROGRAMMABLE_CATEGORIES = [
  'strength',
  'powerlifting',
  'olympic weightlifting',
  'strongman',
  'plyometrics',
] as const;

export interface CandidateExercise {
  id: string;
  slug: string;
  name: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  movementPattern: string | null;
  isUnilateral: boolean;
  category: string | null;
  /**
   * The owned equipment this movement uses, with any per-item ceiling.
   *
   * WHY it is carried on the candidate rather than looked up later: the phase 2
   * load_ceiling rule needs it, and a rule that has to reach back into the
   * database is no longer a pure function over the plan.
   *
   * AI-NOTE: these are the tags the *user owns* that this exercise uses, not
   *          every tag the exercise could use — the join is filtered by the
   *          same .in() that selects the candidate. For this catalogue that is
   *          the same thing: Free Exercise DB records one equipment value per
   *          exercise. It stops being the same thing if a second source with
   *          multi-equipment records is merged in.
   */
  equipment: { slug: string; maxLoadKg: number | null }[];
}

export interface CandidateOptions {
  /** Restrict to these movement patterns, e.g. a pressing day. */
  movementPatterns?: readonly string[];
  /** Include stretching and cardio, which are normally excluded. */
  allCategories?: boolean;
  limit?: number;
}

/** The equipment a user owns, with any per-item load ceiling. */
export async function userEquipment(
  db: Db,
  userId: string
): Promise<{ tagId: string; slug: string; maxLoadKg: number | null }[]> {
  const { data, error } = await db
    .from('user_equipment')
    .select('equipment_tag_id, max_load_kg, equipment_tags!inner(slug)')
    .eq('user_id', userId);

  if (error) throw new Error(`reading user_equipment: ${error.message}`);

  return (data ?? []).map((row) => ({
    tagId: row.equipment_tag_id,
    slug: (row.equipment_tags as unknown as { slug: string }).slug,
    maxLoadKg: row.max_load_kg,
  }));
}

/**
 * Exercises this user can actually perform.
 *
 * Returns an empty list when the user owns no equipment, rather than falling
 * back to everything. AI-NOTE: that is deliberate — a silent "show them all"
 * fallback would hand the planner a barbell for someone who owns dumbbells, and
 * the failure would look like a model mistake rather than a missing row.
 */
export async function availableExercises(
  db: Db,
  userId: string,
  options: CandidateOptions = {}
): Promise<CandidateExercise[]> {
  const equipment = await userEquipment(db, userId);
  if (equipment.length === 0) return [];

  let query = db
    .from('exercises')
    .select(
      'id, slug, name, primary_muscle, secondary_muscles, movement_pattern, is_unilateral, category, exercise_equipment!inner(equipment_tag_id)'
    )
    .in(
      'exercise_equipment.equipment_tag_id',
      equipment.map((e) => e.tagId)
    );

  if (!options.allCategories) {
    query = query.in('category', PROGRAMMABLE_CATEGORIES as unknown as string[]);
  }
  if (options.movementPatterns && options.movementPatterns.length > 0) {
    query = query.in('movement_pattern', options.movementPatterns as string[]);
  }
  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query.order('name');
  if (error) throw new Error(`reading candidate exercises: ${error.message}`);

  const byTagId = new Map(equipment.map((e) => [e.tagId, e]));

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    primaryMuscle: row.primary_muscle,
    secondaryMuscles: row.secondary_muscles,
    movementPattern: row.movement_pattern,
    isUnilateral: row.is_unilateral,
    category: row.category,
    equipment: (row.exercise_equipment as unknown as { equipment_tag_id: string }[])
      .map((link) => byTagId.get(link.equipment_tag_id))
      .filter(
        (e): e is { tagId: string; slug: string; maxLoadKg: number | null } => e !== undefined
      )
      .map((e) => ({ slug: e.slug, maxLoadKg: e.maxLoadKg })),
  }));
}
