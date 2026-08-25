/**
 * Loads a user's training history and maps it onto the metrics engine's shapes.
 *
 * WHY this mapping layer exists: src/metrics/ deliberately knows nothing about
 * Supabase so it can be tested without one — invariant #1 makes it the source of
 * every user-visible number, and that is only credible if it is trivially
 * testable. This file is the seam. Nothing here computes anything.
 */
import type { Db } from './client';
import type { ExerciseMuscles, SetRecord, WorkoutRecord, WorkoutStatus } from '../metrics/types';

export interface ExerciseSummary {
  id: string;
  slug: string;
  name: string;
  primaryMuscle: string;
}

export interface History {
  workouts: WorkoutRecord[];
  sets: SetRecord[];
  catalogue: ExerciseMuscles[];
  exercises: Map<string, ExerciseSummary>;
}

export interface WorkoutRow {
  id: string;
  localDate: string;
  status: WorkoutStatus;
  notes: string | null;
  setCount: number;
}

/**
 * Everything needed to compute this user's metrics, in three queries.
 *
 * RLS scopes all of it to the caller, so there is no user_id filter here and no
 * way to forget one — CLAUDE.md #10.
 */
export async function loadHistory(db: Db): Promise<History> {
  const [{ data: workouts, error: wErr }, { data: sets, error: sErr }] = await Promise.all([
    db.from('workouts').select('id, local_date, status').order('local_date'),
    db
      .from('sets')
      .select(
        'exercise_id, weight_kg, reps, rpe, is_warmup, workout_id, workouts!inner(local_date)'
      )
      .order('set_index'),
  ]);

  if (wErr) throw new Error(`loading workouts: ${wErr.message}`);
  if (sErr) throw new Error(`loading sets: ${sErr.message}`);

  const setRecords: SetRecord[] = (sets ?? []).map((row) => ({
    exerciseId: row.exercise_id,
    // Postgres numerics arrive as strings; Number() once here rather than at
    // every call site downstream.
    weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
    reps: row.reps,
    rpe: row.rpe === null ? null : Number(row.rpe),
    isWarmup: row.is_warmup,
    localDate: (row.workouts as unknown as { local_date: string }).local_date,
  }));

  const exerciseIds = [...new Set(setRecords.map((s) => s.exerciseId))];
  const { data: exercises, error: eErr } = exerciseIds.length
    ? await db
        .from('exercises')
        .select('id, slug, name, primary_muscle, secondary_muscles')
        .in('id', exerciseIds)
    : { data: [], error: null };
  if (eErr) throw new Error(`loading exercises: ${eErr.message}`);

  return {
    workouts: (workouts ?? []).map((w) => ({
      id: w.id,
      localDate: w.local_date,
      status: w.status as WorkoutStatus,
    })),
    sets: setRecords,
    catalogue: (exercises ?? []).map((e) => ({
      exerciseId: e.id,
      primaryMuscle: e.primary_muscle,
      secondaryMuscles: e.secondary_muscles ?? [],
    })),
    exercises: new Map(
      (exercises ?? []).map((e) => [
        e.id,
        { id: e.id, slug: e.slug, name: e.name, primaryMuscle: e.primary_muscle },
      ])
    ),
  };
}

/** The workout list, newest first, with a set count for each. */
export async function listWorkouts(db: Db, limit = 40): Promise<WorkoutRow[]> {
  const { data, error } = await db
    .from('workouts')
    .select('id, local_date, status, notes, sets(count)')
    .order('local_date', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`listing workouts: ${error.message}`);

  return (data ?? []).map((w) => ({
    id: w.id,
    localDate: w.local_date,
    status: w.status as WorkoutStatus,
    notes: w.notes,
    setCount: (w.sets as unknown as { count: number }[])[0]?.count ?? 0,
  }));
}

export interface LoggedSet {
  id: string;
  exerciseId: string;
  exerciseName: string;
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  restSeconds: number | null;
  isWarmup: boolean;
}

export interface WorkoutDetail {
  /** ISO instant the session began, for the elapsed timer. Null until started. */
  startedAt: string | null;
  id: string;
  localDate: string;
  status: WorkoutStatus;
  notes: string | null;
  sets: LoggedSet[];
}

export async function loadWorkout(db: Db, workoutId: string): Promise<WorkoutDetail | null> {
  const { data, error } = await db
    .from('workouts')
    .select(
      'id, local_date, status, notes, started_at, sets(id, exercise_id, set_index, weight_kg, reps, rpe, rest_seconds, is_warmup, exercises(name))'
    )
    .eq('id', workoutId)
    .maybeSingle();

  if (error) throw new Error(`loading workout: ${error.message}`);
  if (!data) return null;

  const rows = (data.sets ?? []) as unknown as {
    id: string;
    exercise_id: string;
    set_index: number;
    weight_kg: string | null;
    reps: number | null;
    rpe: string | null;
    rest_seconds: number | null;
    is_warmup: boolean;
    exercises: { name: string } | null;
  }[];

  return {
    id: data.id,
    startedAt: data.started_at,
    localDate: data.local_date,
    status: data.status as WorkoutStatus,
    notes: data.notes,
    sets: rows
      .map((s) => ({
        id: s.id,
        exerciseId: s.exercise_id,
        exerciseName: s.exercises?.name ?? 'Unknown exercise',
        setIndex: s.set_index,
        weightKg: s.weight_kg === null ? null : Number(s.weight_kg),
        reps: s.reps,
        rpe: s.rpe === null ? null : Number(s.rpe),
        restSeconds: s.rest_seconds,
        isWarmup: s.is_warmup,
      }))
      .sort((a, b) =>
        a.exerciseName === b.exerciseName
          ? a.setIndex - b.setIndex
          : a.exerciseName.localeCompare(b.exerciseName)
      ),
  };
}
