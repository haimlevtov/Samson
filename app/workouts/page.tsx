import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { listWorkouts, loadHistory } from '@/src/db/training';
import { acwr, acwrBand } from '@/src/metrics/acwr';
import { adherence, currentStreak } from '@/src/metrics/adherence';
import { exerciseBests } from '@/src/metrics/pr';
import { addDays } from '@/src/metrics/dates';
import { tonnageByWeek, totalTonnage } from '@/src/metrics/tonnage';
import { signOut } from '../sign-in/actions';
import { startWorkout } from './actions';

export const dynamic = 'force-dynamic';

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;

export default async function WorkoutsPage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const [history, workouts] = await Promise.all([loadHistory(db), listWorkouts(db)]);

  // INVARIANT: every number below is computed by src/metrics, never by a model
  //            — CLAUDE.md #1. This page only formats them.
  const today = localDateFor(user.timezone);
  const last7 = adherence(history.workouts, { start: addDays(today, -27), end: today });
  const streak = currentStreak(history.workouts, today);
  const load = acwr(history.sets, today);
  const weekly = [...tonnageByWeek(history.sets).entries()];
  const thisWeek = weekly.at(-1);
  const bests = exerciseBests(history.sets);

  const topLifts = [...bests.values()]
    .filter((b) => b.bestE1rm !== null)
    .sort((a, b) => b.bestE1rm! - a.bestE1rm!)
    .slice(0, 5);

  const peak = Math.max(...weekly.map(([, v]) => v), 1);

  return (
    <>
      <header className="top">
        <div>
          <h1>{user.displayName ?? user.email}</h1>
          <span className="muted small">
            {user.timezone} · today is {today}
          </span>
        </div>
        <div className="row">
          <form action={startWorkout}>
            <button type="submit">Start workout</button>
          </form>
          <form action={signOut}>
            <button type="submit" className="secondary">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div className="grid cols-4">
        <div className="stat">
          <div className="label">Adherence · 4 wks</div>
          <div className="value">
            {last7.rate === null ? '—' : `${Math.round(last7.rate * 100)}%`}
          </div>
          <div className="muted small">
            {last7.kept} of {last7.resolved} sessions
          </div>
        </div>
        <div className="stat">
          <div className="label">Streak</div>
          <div className="value">{streak}</div>
          <div className="muted small">rest days count</div>
        </div>
        <div className="stat">
          <div className="label">This week</div>
          <div className="value">{thisWeek ? kg(thisWeek[1]) : '—'}</div>
          <div className="muted small">{kg(totalTonnage(history.sets))} all time</div>
        </div>
        <div className="stat">
          <div className="label">Acute : chronic</div>
          <div className="value">{load.ratio === null ? '—' : load.ratio.toFixed(2)}</div>
          <div className="muted small">
            {load.ratio === null
              ? `${load.chronicDaysCovered}/28 days of history`
              : acwrBand(load.ratio).replace('-', ' ')}
          </div>
        </div>
      </div>

      <h2 style={{ fontSize: 15, marginTop: 32 }}>Weekly tonnage</h2>
      <div className="card grid" style={{ gap: 8 }}>
        {weekly.slice(-12).map(([week, value]) => (
          <div key={week} className="row" style={{ gap: 12 }}>
            <span className="muted small" style={{ width: 88 }}>
              {week}
            </span>
            <span className="bar" style={{ flex: 1 }}>
              <span style={{ width: `${(value / peak) * 100}%` }} />
            </span>
            <span className="small" style={{ width: 80, textAlign: 'right' }}>
              {kg(value)}
            </span>
          </div>
        ))}
        {weekly.length === 0 ? <p className="muted small">No sets logged yet.</p> : null}
      </div>

      <h2 style={{ fontSize: 15, marginTop: 32 }}>Best estimated 1RM</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Lift</th>
              <th>e1RM</th>
              <th>Best set</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {topLifts.map((b) => (
              <tr key={b.exerciseId}>
                <td>{history.exercises.get(b.exerciseId)?.name ?? b.exerciseId}</td>
                <td>{b.bestE1rm!.toFixed(1)} kg</td>
                <td className="muted">{b.bestWeightKg} kg</td>
                <td className="muted small">{b.bestE1rmDate}</td>
              </tr>
            ))}
            {topLifts.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted small">
                  Nothing estimable yet — Epley needs a loaded set of 12 reps or fewer.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 15, marginTop: 32 }}>Sessions</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>Sets</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {workouts.map((w) => (
              <tr key={w.id}>
                <td>
                  <Link href={`/workouts/${w.id}`}>{w.localDate}</Link>
                </td>
                <td>
                  <span className={`badge ${w.status}`}>{w.status.replace('_', ' ')}</span>
                </td>
                <td className="muted">{w.setCount || '—'}</td>
                <td className="muted small">{w.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
