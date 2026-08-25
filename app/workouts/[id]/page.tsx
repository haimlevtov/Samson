import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { loadWorkout } from '@/src/db/training';
import { availableExercises } from '@/src/db/exercises';
import { epleyE1rm } from '@/src/metrics/e1rm';
import { totalTonnage } from '@/src/metrics/tonnage';
import { RestTimer } from './RestTimer';
import { deleteSet, finishWorkout, logSet } from '../actions';

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
  const candidates = await availableExercises(db, user.id, { limit: 400 });

  const byPattern = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const key = c.movementPattern ?? 'other';
    const list = byPattern.get(key);
    if (list) list.push(c);
    else byPattern.set(key, [c]);
  }

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
          <h1>{workout.localDate}</h1>
          <span className="muted small">
            <span className={`badge ${workout.status}`}>{workout.status.replace('_', ' ')}</span> ·{' '}
            {working.length} working sets · {Math.round(tonnage).toLocaleString()} kg
          </span>
        </div>
        <Link href="/workouts">← All sessions</Link>
      </header>

      {editable ? <RestTimer /> : null}

      <h2 style={{ fontSize: 15, marginTop: 28 }}>Logged sets</h2>
      <div className="card">
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
                        <button type="submit" className="secondary small">
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

      {editable ? (
        <>
          <h2 style={{ fontSize: 15, marginTop: 28 }}>Add a set</h2>
          <div className="card">
            <form action={logSet} className="row" style={{ alignItems: 'flex-end' }}>
              <input type="hidden" name="workoutId" value={workout.id} />

              <label className="grid" style={{ gap: 4, flex: '2 1 260px' }}>
                <span className="small muted">Exercise · {candidates.length} available to you</span>
                <select name="exerciseId" required defaultValue="">
                  <option value="" disabled>
                    Choose…
                  </option>
                  {[...byPattern.entries()]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([pattern, list]) => (
                      <optgroup key={pattern} label={pattern}>
                        {list.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
              </label>

              <label className="grid" style={{ gap: 4, width: 100 }}>
                <span className="small muted">Weight kg</span>
                <input name="weightKg" type="number" step="0.5" min="0" inputMode="decimal" />
              </label>

              <label className="grid" style={{ gap: 4, width: 80 }}>
                <span className="small muted">Reps</span>
                <input name="reps" type="number" step="1" min="0" inputMode="numeric" />
              </label>

              <label className="grid" style={{ gap: 4, width: 80 }}>
                <span className="small muted">RPE</span>
                <input name="rpe" type="number" step="0.5" min="1" max="10" inputMode="decimal" />
              </label>

              <label className="grid" style={{ gap: 4, width: 90 }}>
                <span className="small muted">Rest s</span>
                <input name="restSeconds" type="number" step="15" min="0" inputMode="numeric" />
              </label>

              <label className="row small" style={{ gap: 6 }}>
                <input name="isWarmup" type="checkbox" style={{ width: 16, height: 16 }} />
                Warmup
              </label>

              <button type="submit">Log set</button>
            </form>
            {candidates.length === 0 ? (
              <p className="error small">
                No equipment recorded, so nothing can be prescribed. Seeded users have equipment; a
                new account needs rows in <code>user_equipment</code>.
              </p>
            ) : null}
          </div>

          <h2 style={{ fontSize: 15, marginTop: 28 }}>Finish</h2>
          <div className="card">
            <form action={finishWorkout} className="grid">
              <input type="hidden" name="workoutId" value={workout.id} />
              <label className="grid" style={{ gap: 4 }}>
                <span className="small muted">Notes (optional)</span>
                <input name="notes" placeholder="Felt heavy, right knee a bit tight" />
              </label>
              <div>
                <button type="submit">Finish session</button>
              </div>
            </form>
          </div>
        </>
      ) : null}
    </>
  );
}
