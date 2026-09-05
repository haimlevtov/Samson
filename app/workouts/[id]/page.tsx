import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { loadPreviousSets, loadWorkout } from '@/src/db/training';
import { availableExercises } from '@/src/db/exercises';
import { totalTonnage } from '@/src/metrics/tonnage';
import { displayDate } from '@/src/ui/format';
import { FinishForm } from './FinishForm';
import { SessionConsole, type Candidate } from './SessionConsole';
import { SessionTimer } from './SessionTimer';

export const dynamic = 'force-dynamic';

export default async function WorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const workout = await loadWorkout(db, id);
  // RLS returns nothing for another user's workout, so "not mine" and "does not
  // exist" are the same 404 — no probing for valid ids.
  if (!workout) notFound();

  // INVARIANT: the picker is filtered in SQL by the equipment this user owns,
  //            before anything is rendered or, later, sent to a model — #5.
  const rows = await availableExercises(db, user.id);
  const candidates: Candidate[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    movementPattern: c.movementPattern,
    primaryMuscle: c.primaryMuscle,
  }));

  // What this lift went for last time — the number the next set is chosen from,
  // and the PREVIOUS column of the grid. ADR 0011.
  const previous = await loadPreviousSets(db, workout.id, workout.localDate);

  const working = workout.sets.filter((s) => !s.isWarmup);
  const tonnage = totalTonnage(
    workout.sets.map((s) => ({
      exerciseId: s.exerciseId,
      weightKg: s.weightKg,
      reps: s.reps,
      isWarmup: s.isWarmup,
      localDate: workout.localDate,
    }))
  );

  const editable = workout.status === 'in_progress' || workout.status === 'planned';

  return (
    <>
      {/* Back, the clock and the way out, in one row that stays put while the
          grid scrolls under it. */}
      <div className="session-bar">
        <Link href="/workouts" className="bar-back" aria-label="All sessions">
          ←
        </Link>
        <SessionTimer startedAt={workout.startedAt} endedAt={workout.endedAt} />
        {editable ? (
          <button type="submit" form="finish-session" className="bar-finish">
            Finish
          </button>
        ) : (
          <span className={`badge ${workout.status}`}>{workout.status.replace('_', ' ')}</span>
        )}
      </div>

      <header className="top">
        <div>
          <h1>{displayDate(workout.localDate)}</h1>
          <span className="muted small">
            {working.length} working set{working.length === 1 ? '' : 's'} ·{' '}
            {Math.round(tonnage).toLocaleString()} kg
          </span>
        </div>
      </header>

      <SessionConsole
        workoutId={workout.id}
        logged={workout.sets}
        previous={previous}
        candidates={candidates}
        editable={editable}
      />

      {editable ? (
        <>
          <h2 className="section">Finish</h2>
          <div className="card">
            <FinishForm workoutId={workout.id} />
          </div>
        </>
      ) : null}

      {!editable && workout.notes ? (
        <>
          <h2 className="section">Notes</h2>
          {/* Rendered as text, never as instructions — CLAUDE.md #11. */}
          <div className="card">{workout.notes}</div>
        </>
      ) : null}
    </>
  );
}
