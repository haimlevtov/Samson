/**
 * Reading and writing workout templates.
 *
 * INVARIANT: RLS scopes every query below to the caller — CLAUDE.md #10. There
 *            is no `user_id` filter here and therefore none to forget; the
 *            `user_id` written on insert comes from the verified session and
 *            the policy independently rejects anything else.
 *
 * INVARIANT: nothing in this file writes to `sets` — ADR 0010. A template says
 *            what to do; `sets` says what was done, and the two must never be
 *            written by the same action.
 *
 * Contract: docs/specs/workout-templates.md.
 */
import type { Db } from './client';
import { templateDraftSchema, type TemplateDraft, type TemplateSource } from '../templates/schema';

export interface TemplateSummary {
  id: string;
  name: string;
  source: TemplateSource;
  itemCount: number;
  createdAt: string;
  /**
   * The lifts it prescribes, in order, deduplicated.
   *
   * WHY on the summary rather than fetched per card: a template's name is
   * whatever someone typed, and "Full body B" tells you nothing about whether
   * it is the one with squats. The card is unreadable without this, and the
   * rows are already joined for the count.
   */
  exercises: string[];
}

export interface TemplateItem {
  id: string;
  exerciseId: string;
  exerciseName: string;
  position: number;
  setCount: number;
  reps: number;
  /** INVARIANT: kilograms — CLAUDE.md #8. Null is bodyweight, not zero. */
  weightKg: number | null;
  rpe: number | null;
  restSeconds: number | null;
}

export interface TemplateDetail {
  id: string;
  name: string;
  source: TemplateSource;
  notes: string | null;
  items: TemplateItem[];
}

/** Newest first, with the number of set groups each one prescribes. */
export async function listTemplates(db: Db): Promise<TemplateSummary[]> {
  const { data, error } = await db
    .from('workout_templates')
    .select('id, name, source, created_at, workout_template_items(position, exercises(name))')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`listing templates: ${error.message}`);

  return (data ?? []).map((row) => {
    const items = (row.workout_template_items ?? []) as unknown as {
      position: number;
      exercises: { name: string } | null;
    }[];
    const ordered = [...items].sort((a, b) => a.position - b.position);

    return {
      id: row.id,
      name: row.name,
      source: row.source as TemplateSource,
      createdAt: row.created_at,
      itemCount: ordered.length,
      // Deduplicated: three set groups of squats are one lift on the card, and
      // repeating the name three times would push the others off the line.
      exercises: [
        ...new Set(ordered.map((i) => i.exercises?.name).filter((n): n is string => Boolean(n))),
      ],
    };
  });
}

export async function loadTemplate(db: Db, templateId: string): Promise<TemplateDetail | null> {
  const { data, error } = await db
    .from('workout_templates')
    .select(
      'id, name, source, notes, workout_template_items(id, exercise_id, position, set_count, reps, weight_kg, rpe, rest_seconds, exercises(name))'
    )
    .eq('id', templateId)
    .maybeSingle();

  if (error) throw new Error(`loading template: ${error.message}`);
  if (!data) return null;

  const rows = (data.workout_template_items ?? []) as unknown as {
    id: string;
    exercise_id: string;
    position: number;
    set_count: number;
    reps: number;
    weight_kg: string | null;
    rpe: string | null;
    rest_seconds: number | null;
    exercises: { name: string } | null;
  }[];

  return {
    id: data.id,
    name: data.name,
    source: data.source as TemplateSource,
    notes: data.notes,
    items: rows
      .map((r) => ({
        id: r.id,
        exerciseId: r.exercise_id,
        exerciseName: r.exercises?.name ?? 'Unknown exercise',
        position: r.position,
        setCount: r.set_count,
        reps: r.reps,
        // Postgres numerics arrive as strings; Number() once here rather than
        // at every call site downstream, as src/db/training.ts does.
        weightKg: r.weight_kg === null ? null : Number(r.weight_kg),
        rpe: r.rpe === null ? null : Number(r.rpe),
        restSeconds: r.rest_seconds,
      }))
      // INVARIANT: ascending position — src/templates/progress.ts allocates in
      //            the order it is given, and this is the one place that order
      //            is established.
      .sort((a, b) => a.position - b.position),
  };
}

/**
 * Writes a template and its items.
 *
 * AI-NOTE: PostgREST gives no transaction across two requests, so a failed item
 *          insert is compensated by deleting the parent rather than left as a
 *          template with no exercises in it. A named template that opens empty
 *          is worse than one that never appeared: the user would start it.
 */
export async function createTemplate(
  db: Db,
  userId: string,
  draft: TemplateDraft
): Promise<string> {
  // Re-validated here even though the caller has usually parsed it already.
  // This is the last point before the database, and the bounds are the
  // contract — docs/specs/workout-templates.md §2.
  const valid = templateDraftSchema.parse(draft);

  const { data, error } = await db
    .from('workout_templates')
    .insert({
      user_id: userId,
      name: valid.name,
      source: valid.source,
      // AI-NOTE: untrusted free text — CLAUDE.md #11. Stored, displayed, and
      //          never interpolated into a system prompt.
      notes: valid.notes,
    })
    .select('id')
    .single();

  if (error) throw new Error(`creating template: ${error.message}`);

  const { error: itemsError } = await db.from('workout_template_items').insert(
    valid.items.map((item, index) => ({
      user_id: userId,
      template_id: data.id,
      exercise_id: item.exerciseId,
      position: index,
      set_count: item.setCount,
      reps: item.reps,
      weight_kg: item.weightKg,
      rpe: item.rpe,
      rest_seconds: item.restSeconds,
    }))
  );

  if (itemsError) {
    await db.from('workout_templates').delete().eq('id', data.id);
    throw new Error(`creating template items: ${itemsError.message}`);
  }

  return data.id;
}

export async function deleteTemplate(db: Db, templateId: string): Promise<void> {
  // Items go with it by cascade; sessions run from it keep their history and
  // lose only the link — `on delete set null` in the migration, ADR 0010.
  const { error } = await db.from('workout_templates').delete().eq('id', templateId);
  if (error) throw new Error(`deleting template: ${error.message}`);
}

/**
 * Resolves planner slugs to catalogue ids for a coach import.
 *
 * WHY slugs cross that boundary at all: `prescribedExerciseSchema` has the
 * reasoning — a model copying a 36-character uuid corrupts one character and
 * the result reads as a hallucinated exercise rather than a typo.
 */
export async function exerciseIdsBySlug(
  db: Db,
  slugs: readonly string[]
): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();

  const { data, error } = await db
    .from('exercises')
    .select('id, slug')
    .in('slug', [...new Set(slugs)]);

  if (error) throw new Error(`resolving exercise slugs: ${error.message}`);

  return new Map((data ?? []).map((row) => [row.slug, row.id]));
}
