import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { loadWorkout } from '@/src/db/training';
import { availableExercises } from '@/src/db/exercises';
import { epleyE1rm } from '@/src/metrics/e1rm';
import { totalTonnage } from '@/src/metrics/tonnage';
import { displayDate } from '@/src/ui/format';
import { SessionConsole, type Candidate } from './SessionConsole';
import { deleteSet, finishWorkout } from '../actions';

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
      <header className="top">
        <div>
          <h1>{displayDate(workout.localDate)}</h1>
          <span className="muted small">
            <span className={`badge ${workout.status}`}>{workout.status.replace('_', ' ')}</span> ·{' '}
            {working.length} working sets · {Math.round(tonnage).toLocaleString()} kg
          </span>
        </div>
        <Link href="/workouts">← All sessions</Link>
      </header>

      {editable ? (
        <SessionConsole
          workoutId={workout.id}
          startedAt={workout.startedAt}
          candidates={candidates}
        />
      ) : null}

      <h2 className="section">Logged sets</h2>
      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Exercise</th>
                <th>#</th>
                <th>Weight</th>
                <th>Reps</th>
                <th>RPE</th>
                <th>e1RM</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {workout.sets.map((s) => {
                const estimate = s.isWarmup ? null : epleyE1rm(s.weightKg, s.reps);
                return (
                  <tr key={s.id}>
                    <td>
                      {s.exerciseName}
                      {s.isWarmup ? <span className="badge"> warmup</span> : null}
                    </td>
                    <td className="muted">{s.setIndex + 1}</td>
                    <td>{s.weightKg === null ? '—' : `${s.weightKg} kg`}</td>
                    <td>{s.reps ?? '—'}</td>
                    <td className="muted">{s.rpe ?? '—'}</td>
                    {/* Null above 12 reps: Epley stops being honest there. */}
                    <td className="muted">{estimate === null ? '—' : estimate.toFixed(1)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {editable ? (
                        <form action={deleteSet}>
                          <input type="hidden" name="setId" value={s.id} />
                          <input type="hidden" name="workoutId" value={workout.id} />
                          <button type="submit" className="secondary">
                            Delete
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {workout.sets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted small">
                    Nothing logged yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {editable ? (
        <>
          <h2 className="section">Finish</h2>
          <div className="card">
            <form action={finishWorkout} className="finish-form">
              <input type="hidden" name="workoutId" value={workout.id} />
              <label>
                <span className="label">Notes (optional)</span>
                <input name="notes" placeholder="Felt heavy, right knee a bit tight" />
              </label>
              <button type="submit">Finish session</button>
            </form>
          </div>
        </>
      ) : null}
    </>
  );
}
