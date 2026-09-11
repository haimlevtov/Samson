/**
 * One session of the coach's accepted plan, as a template.
 *
 * INVARIANT: the LLM never computes a number — CLAUDE.md #1. Every figure here
 *            is copied verbatim from an accepted `plan_runs` block. Nothing is
 *            recomputed, rounded or re-derived, and no model is called: the
 *            model's contribution ended when that plan was accepted.
 *
 * A block the planner pipeline wrote has already passed `src/planner/rules.ts`
 * and the safety critic. `plan_runs` also lets a user insert their own accepted
 * row; a block written that way reaches only that user's own templates, which
 * they can already build by hand. Narrowed in review of PR 7.
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

/** One session of a plan, as the import control lists it. */
export interface PlanSessionOption {
  weekNumber: number;
  dayIndex: number;
  /**
   * The name the import starts from — `plannedSessionName`. A second import of
   * the same session stores it with a counter (`distinctName`).
   */
  label: string;
}

/**
 * Every session of a block, in order, as the import control lists them.
 *
 * WHY one builder: `/workout/new` built this inline, and `/coach` would have been
 * a second copy — one that could label a session differently from the name it
 * saves. Rework plan, PR 7.
 */
export function planSessionOptions(
  block: { weeks: { week_number: number; sessions: PlannedSession[] }[] } | null | undefined
): PlanSessionOption[] {
  return (block?.weeks ?? []).flatMap((week) =>
    week.sessions.map((session) => ({
      weekNumber: week.week_number,
      dayIndex: session.day_index,
      label: plannedSessionName(week.week_number, session),
    }))
  );
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
