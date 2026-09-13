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

/** The session you are in the middle of right now, if there is one. */
export interface ActiveWorkout {
  id: string;
  localDate: string;
  startedAt: string | null;
}

/**
 * How recently a session must have started to count as one you are in.
 *
 * WHY a duration and not the local date — FOUND IN REVIEW, 2026-09-07: this was
 * `local_date = today`, which is a calendar match, and "am I in the middle of a
 * session" is not a calendar question. A session begun at 23:55 stopped being
 * active at midnight while the user was still logging into it, so the Workout
 * tab offered Start again and a tap created the second row this whole change
 * exists to prevent.
 *
 * WHY it does not touch CLAUDE.md #9: this compares a UTC instant to a UTC
 * instant. `local_date` remains the write-time truth for every calendar
 * question — streaks, achievements, challenge windows — and is untouched.
 *
 * Twelve hours is longer than any session and shorter than a night's sleep, so
 * a workout abandoned yesterday is a loose end rather than a redirect you
 * cannot escape. Loose ends belong in History, which shows them with their
 * `in progress` badge and lets them be finished.
 */
export const ACTIVE_SESSION_WINDOW_HOURS = 12;

/**
 * The session you are in the middle of, if there is one.
 *
 * AI-NOTE: `started_at` is compared, not `local_date`, and that also disposes
 *          of a NULLS-FIRST hazard the calendar version had. `order by ... desc`
 *          is NULLS FIRST in Postgres, so a row with no `started_at` outranked
 *          every real session and won the `limit(1)`. A `gte` on the same
 *          column excludes nulls outright — but `nullsFirst: false` is set
 *          anyway, because the next person to relax that filter should not
 *          have to rediscover this. See `loadExerciseHistory` below, which
 *          carries the same note.
 */
export async function activeWorkout(db: Db, now: Date = new Date()): Promise<ActiveWorkout | null> {
  const since = new Date(now.getTime() - ACTIVE_SESSION_WINDOW_HOURS * 60 * 60 * 1000);

  const { data, error } = await db
    .from('workouts')
    .select('id, local_date, started_at')
    .eq('status', 'in_progress')
    .gte('started_at', since.toISOString())
    .order('started_at', { ascending: false, nullsFirst: false })
    .limit(1);

  if (error) throw new Error(`loading the active session: ${error.message}`);

  const row = data?.[0];
  return row === undefined
    ? null
    : { id: row.id, localDate: row.local_date, startedAt: row.started_at };
}

/** One workout of a day, as the rest-day decision in `src/ui/rest.ts` reads it. */
export interface DayWorkout {
  id: string;
  status: WorkoutStatus;
  /** Sets logged into it. An empty session is not training — ADR 0034 §4. */
  setCount: number;
}

/**
 * One local day's workouts, whatever their status — the rest-day decision in
 * `src/ui/rest.ts` reads them. RLS scopes the read to the caller.
 *
 * INVARIANT: `localDate` is the user's local date, computed by the caller from
 *            `users.timezone` — CLAUDE.md #9.
 */
export async function workoutsOn(db: Db, localDate: string): Promise<DayWorkout[]> {
  const { data, error } = await db
    .from('workouts')
    .select('id, status, sets(count)')
    .eq('local_date', localDate);
  if (error) throw new Error(`loading the day's workouts: ${error.message}`);
  return (data ?? []).map((w) => ({
    id: w.id,
    status: w.status as WorkoutStatus,
    setCount: (w.sets as unknown as { count: number }[])[0]?.count ?? 0,
  }));
}

/**
 * The index that makes a rest day one a day — migration 20260913100000.
 *
 * AI-NOTE: matched by name below. Renaming the index means changing this, the
 *          migration, and tests/db/rest-days.test.ts together.
 */
const ONE_REST_A_DAY = 'workouts_one_rest_a_day';

/**
 * Logs a rest day — ADR 0034. Returns the new row's id, or null when that day
 * already has one: the unique index refused it, which is a second press racing
 * the first rather than an error.
 *
 * INVARIANT: the request-scoped, RLS-bound client, and a `userId` from the
 *            verified session — CLAUDE.md #10. It writes the workout and nothing
 *            else: what the day earns is `award_session_xp`'s — ADR 0009.
 */
export async function insertRestDay(
  db: Db,
  userId: string,
  localDate: string
): Promise<string | null> {
  const { data, error } = await db
    .from('workouts')
    .insert({ user_id: userId, local_date: localDate, status: 'rest' })
    .select('id')
    .single();

  // Named, not just 23505: a different unique violation is a bug to surface.
  if (error?.code === '23505' && error.message.includes(ONE_REST_A_DAY)) return null;
  if (error) throw new Error(`logging a rest day: ${error.message}`);
  return data.id;
}

/**
 * The workout list, newest first, with a set count for each.
 *
 * `excludeId` leaves out the session currently being performed: History is
 * where a session goes when it is over, and one that is still being logged
 * appearing in the list of past sessions is the app telling the user they have
 * finished something they are still doing.
 */
export async function listWorkouts(
  db: Db,
  limit = 40,
  excludeId: string | null = null
): Promise<WorkoutRow[]> {
  let query = db
    .from('workouts')
    .select('id, local_date, status, notes, sets(count)')
    .order('local_date', { ascending: false })
    .limit(limit);

  if (excludeId !== null) query = query.neq('id', excludeId);

  const { data, error } = await query;

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
  /** When the set was performed. Orders the exercises as the session ran. */
  completedAt: string | null;
}

export interface WorkoutDetail {
  /** ISO instant the session began, for the elapsed timer. Null until started. */
  startedAt: string | null;
  /** ISO instant it was finished. The clock stops here rather than at now. */
  endedAt: string | null;
  /**
   * The template this session was started from, if any — ADR 0010. Null once
   * that template is deleted (`on delete set null`): the history survives, the
   * link does not.
   */
  templateId: string | null;
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
      'id, local_date, status, notes, started_at, ended_at, template_id, sets(id, exercise_id, set_index, weight_kg, reps, rpe, rest_seconds, is_warmup, completed_at, exercises(name))'
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
    completed_at: string | null;
    exercises: { name: string } | null;
  }[];

  const sets: LoggedSet[] = rows.map((s) => ({
    id: s.id,
    exerciseId: s.exercise_id,
    exerciseName: s.exercises?.name ?? 'Unknown exercise',
    setIndex: s.set_index,
    weightKg: s.weight_kg === null ? null : Number(s.weight_kg),
    reps: s.reps,
    rpe: s.rpe === null ? null : Number(s.rpe),
    restSeconds: s.rest_seconds,
    isWarmup: s.is_warmup,
    completedAt: s.completed_at,
  }));

  return {
    id: data.id,
    startedAt: data.started_at,
    endedAt: data.ended_at,
    templateId: data.template_id,
    localDate: data.local_date,
    status: data.status as WorkoutStatus,
    notes: data.notes,
    sets: orderBySession(sets),
  };
}

/**
 * Session order, not alphabetical order.
 *
 * WHY: the screen groups sets by exercise (ADR 0011), and a session is a
 * sequence — squats, then bench, then rows. Sorting the groups by name would
 * reorder the workout every time someone added a lift beginning with "A", and
 * the user's memory of what they just did is chronological.
 */
export function orderBySession(sets: LoggedSet[]): LoggedSet[] {
  const firstSeen = new Map<string, string>();
  for (const set of sets) {
    const at = set.completedAt ?? '';
    const known = firstSeen.get(set.exerciseId);
    if (known === undefined || at < known) firstSeen.set(set.exerciseId, at);
  }

  return [...sets].sort((a, b) => {
    if (a.exerciseId !== b.exerciseId) {
      const byStart = (firstSeen.get(a.exerciseId) ?? '').localeCompare(
        firstSeen.get(b.exerciseId) ?? ''
      );
      // Two exercises whose first set carries no timestamp fall back to the
      // name, so the order is at least stable between renders.
      if (byStart !== 0) return byStart;
      return a.exerciseName.localeCompare(b.exerciseName);
    }
    return a.setIndex - b.setIndex;
  });
}

/** One set from an earlier session, for the grid's PREVIOUS column. */
export interface PreviousSet {
  weightKg: number | null;
  reps: number | null;
}

/**
 * Last session's sets, split by kind.
 *
 * WHY split rather than one list read by position: `set_index` counts warm-ups,
 * so a session that ramped through three of them would put 42.5 kg next to
 * today's first working set. The rows do not line up by position; they line up
 * by what they are. A row with no counterpart of its own kind gets an em dash,
 * which is the honest answer.
 */
export interface PreviousSets {
  warmup: PreviousSet[];
  working: PreviousSet[];
}

/** A set row as it arrives from the previous-sessions query. */
export interface PriorSetRow {
  exerciseId: string;
  workoutId: string;
  localDate: string;
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  isWarmup: boolean;
}

/**
 * The last session's sets for each exercise, by position.
 *
 * WHY this is a pure function rather than SQL: "the most recent session that
 * contained this lift" is a rule, and a rule that decides what the user reads
 * before choosing a weight is worth a test. The query part — which rows —
 * cannot be wrong in an interesting way; this part can.
 *
 * The caller has already excluded the current workout and anything later than
 * it. Ties on the same local date break on workout id: arbitrary, but the same
 * arbitrary answer on every render, which is what matters.
 */
export function pickPreviousSets(rows: PriorSetRow[]): Record<string, PreviousSets> {
  const latest = new Map<string, { key: string; sets: PriorSetRow[] }>();

  for (const row of rows) {
    const key = `${row.localDate}#${row.workoutId}`;
    const held = latest.get(row.exerciseId);
    if (held === undefined || key > held.key) {
      latest.set(row.exerciseId, { key, sets: [row] });
    } else if (key === held.key) {
      held.sets.push(row);
    }
  }

  const out: Record<string, PreviousSets> = {};
  for (const [exerciseId, { sets }] of latest) {
    const ordered = [...sets].sort((a, b) => a.setIndex - b.setIndex);
    const take = (warmup: boolean): PreviousSet[] =>
      ordered
        .filter((s) => s.isWarmup === warmup)
        .map((s) => ({ weightKg: s.weightKg, reps: s.reps }));
    out[exerciseId] = { warmup: take(true), working: take(false) };
  }
  return out;
}

/**
 * WHY the window is capped at 30 sessions rather than searching all of history:
 * a lift nobody has touched in thirty sessions has no useful "last time", and
 * the honest em dash costs one bounded query instead of every set the user has
 * ever logged. Raise the cap before adding a second query.
 */
const PREVIOUS_SESSION_WINDOW = 30;

export async function loadPreviousSets(
  db: Db,
  workoutId: string,
  localDate: string
): Promise<Record<string, PreviousSets>> {
  const { data: workouts, error: wErr } = await db
    .from('workouts')
    .select('id, local_date')
    .neq('id', workoutId)
    .lte('local_date', localDate)
    .order('local_date', { ascending: false })
    .limit(PREVIOUS_SESSION_WINDOW);

  if (wErr) throw new Error(`loading previous sessions: ${wErr.message}`);

  const dates = new Map((workouts ?? []).map((w) => [w.id, w.local_date]));
  if (dates.size === 0) return {};

  const { data: sets, error: sErr } = await db
    .from('sets')
    .select('exercise_id, workout_id, set_index, weight_kg, reps, is_warmup')
    .in('workout_id', [...dates.keys()]);

  if (sErr) throw new Error(`loading previous sets: ${sErr.message}`);

  return pickPreviousSets(
    (sets ?? []).map((s) => ({
      exerciseId: s.exercise_id,
      workoutId: s.workout_id,
      localDate: dates.get(s.workout_id) ?? '',
      setIndex: s.set_index,
      weightKg: s.weight_kg === null ? null : Number(s.weight_kg),
      reps: s.reps,
      isWarmup: s.is_warmup,
    }))
  );
}

/**
 * The only place a set is written.
 *
 * WHY it lives here rather than in the server action: phase 3 adds a second way
 * to log a set — free text through the normalizer — and two write paths would be
 * two definitions of what logging a set means. They would drift, and the one
 * that drifted would be the one nobody was looking at.
 *
 * INVARIANT: user_id comes from the verified session, never a form field, and
 *            RLS rejects any row whose user_id is not auth.uid() — CLAUDE.md #10.
 */
export interface SetToInsert {
  workoutId: string;
  exerciseId: string;
  /** INVARIANT: canonical kilograms — CLAUDE.md #8. */
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  restSeconds: number | null;
  isWarmup: boolean;
}

export async function insertSet(db: Db, userId: string, set: SetToInsert): Promise<void> {
  // The next index for this exercise within this session. Read rather than
  // counted client-side so two tabs cannot collide on the unique constraint.
  const { data: existing } = await db
    .from('sets')
    .select('set_index')
    .eq('workout_id', set.workoutId)
    .eq('exercise_id', set.exerciseId)
    .order('set_index', { ascending: false })
    .limit(1);

  const nextIndex = (existing?.[0]?.set_index ?? -1) + 1;

  const { error } = await db.from('sets').insert({
    user_id: userId,
    workout_id: set.workoutId,
    exercise_id: set.exerciseId,
    set_index: nextIndex,
    weight_kg: set.weightKg,
    reps: set.reps,
    rpe: set.rpe,
    rest_seconds: set.restSeconds,
    is_warmup: set.isWarmup,
    completed_at: new Date().toISOString(),
  });

  if (error) throw new Error(`logging set: ${error.message}`);
}

/**
 * How many set rows one lift's chart will read.
 *
 * INVARIANT: this is BELOW PostgREST's `max_rows` (1000, supabase/config.toml)
 *            on purpose. At or above it, the cap is applied silently and a full
 *            page is indistinguishable from a truncated one; below it, a full
 *            page means we hit our own limit and can say so.
 */
const EXERCISE_SET_CAP = 900;

export interface ExerciseHistory {
  name: string;
  sets: SetRecord[];
  /**
   * True when the read hit `EXERCISE_SET_CAP`, so older sessions exist that are
   * not in `sets` — and the OLDEST day present may be missing its heavier sets.
   */
  truncated: boolean;
}

/**
 * Every logged set of one exercise, for the progression chart — ADR 0014.
 *
 * WHY this exists rather than filtering `loadHistory()`: that reads the user's
 * whole set history to answer questions about all of them at once. This answers
 * one question about one lift, and it is reached from a per-exercise route, so
 * pulling the entire log to throw most of it away would make the cost of the
 * chart grow with the length of somebody's training career.
 *
 * RLS scopes the SETS read to the caller — CLAUDE.md #10 — so there is no
 * user_id filter here and none to forget.
 *
 * The NAME is a different matter, and the difference is worth stating rather
 * than glossing: `exercises_read` is `user_id is null or user_id = auth.uid()`,
 * so the catalogue is shared and any global exercise resolves a name for any
 * user. An id this user has never trained therefore renders the chart's empty
 * state rather than a 404, which is the behaviour we want — but it is the
 * catalogue being public, not RLS hiding anything. Only another user's CUSTOM
 * exercise comes back null.
 */
export async function loadExerciseHistory(
  db: Db,
  exerciseId: string
): Promise<ExerciseHistory | null> {
  const [{ data: exercise, error: eErr }, { data: sets, error: sErr }] = await Promise.all([
    db.from('exercises').select('name').eq('id', exerciseId).maybeSingle(),
    /*
     * INVARIANT: newest first, and bounded. An earlier version ordered by
     *            `set_index` with no limit, which was a silent wrong answer
     *            rather than a slow one: LIMIT applies after ORDER BY, so
     *            PostgREST's 1000-row cap dropped the HIGHEST set indices —
     *            and since set_index counts warm-ups, the discarded rows were
     *            exactly the top sets this chart exists to plot. A lifter with
     *            enough history would have seen their opening sets charted as
     *            their progression, or "nothing to plot" at all.
     *
     * Ordering by `completed_at` instead means truncation drops the OLDEST
     * sessions, which is the one direction a history chart can lose data in and
     * still be honest — and the page says when it happened.
     */
    db
      .from('sets')
      .select('weight_kg, reps, is_warmup, workouts!inner(local_date)')
      .eq('exercise_id', exerciseId)
      .order('completed_at', { ascending: false, nullsFirst: false })
      .limit(EXERCISE_SET_CAP),
  ]);

  if (eErr) throw new Error(`loading exercise: ${eErr.message}`);
  if (sErr) throw new Error(`loading exercise history: ${sErr.message}`);
  if (exercise === null) return null;

  const rows = sets ?? [];

  return {
    name: exercise.name,
    truncated: rows.length >= EXERCISE_SET_CAP,
    sets: rows.map((row) => ({
      // The query filters on it, so every row carries the id we asked for.
      exerciseId,
      // Postgres numerics arrive as strings; Number() once here rather than at
      // every call site downstream, as loadHistory does.
      weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
      reps: row.reps,
      // Not selected: nothing downstream of this function reads rpe, and it is
      // a numeric conversion per row on the largest result this app fetches.
      rpe: null,
      isWarmup: row.is_warmup,
      localDate: (row.workouts as unknown as { local_date: string }).local_date,
    })),
  };
}
