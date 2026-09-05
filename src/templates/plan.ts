/**
 * One session of the coach's accepted plan, as a template.
 *
 * INVARIANT: the LLM never computes a number — CLAUDE.md #1. Every figure here
 *            is copied verbatim from a `plan_runs` block that already passed
 *            `src/planner/rules.ts` and the safety critic. Nothing is
 *            recomputed, rounded or re-derived, and no model is called: the
 *            model's contribution ended when that plan was accepted.
 *
 * INVARIANT: exercises are referenced by slug across the planner boundary and
 *            resolved against the catalogue here — CLAUDE.md #5 and the
 *            AI-NOTE on `prescribedExerciseSchema`.
 *
 * Contract: docs/specs/workout-templates.md §6.
 */
import type { PlannedSession } from '../planner/schema';
import { TEMPLATE_NAME_MAX, type TemplateItemDraft } from './schema';

export type PlanImport =
  { ok: true; name: string; items: TemplateItemDraft[] } | { ok: false; missingSlugs: string[] };

/** `Week 2 · Day 3 — Lower body`, inside the name bound. */
export function plannedSessionName(weekNumber: number, session: PlannedSession): string {
  const name = `Week ${weekNumber} · Day ${session.day_index + 1} — ${session.focus}`;
  if (name.length <= TEMPLATE_NAME_MAX) return name;
  return `${name.slice(0, TEMPLATE_NAME_MAX - 1).trimEnd()}…`;
}

/**
 * WHY an unresolvable slug fails the whole import rather than skipping the
 * exercise: a pressing day that silently arrives without its press looks like a
 * plan the coach wrote, and the user would train it. An error names what is
 * missing and changes nothing.
 */
export function templateFromPlannedSession(
  session: PlannedSession,
  weekNumber: number,
  exerciseIdBySlug: ReadonlyMap<string, string>
): PlanImport {
  const missingSlugs = [
    ...new Set(
      session.exercises.map((e) => e.exercise_slug).filter((slug) => !exerciseIdBySlug.has(slug))
    ),
  ];
  if (missingSlugs.length > 0) return { ok: false, missingSlugs };

  const items: TemplateItemDraft[] = session.exercises.flatMap((exercise) =>
    exercise.set_groups.map((group) => ({
      // Present: the filter above rejected every slug this map lacks.
      exerciseId: exerciseIdBySlug.get(exercise.exercise_slug)!,
      setCount: group.count,
      reps: group.reps,
      weightKg: group.weight_kg,
      rpe: group.rpe,
      restSeconds: group.rest_seconds,
    }))
  );

  return { ok: true, name: plannedSessionName(weekNumber, session), items };
}
