import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { listWorkouts, loadHistory } from '@/src/db/training';
import { acwr, acwrBand } from '@/src/metrics/acwr';
import { adherence, currentStreak } from '@/src/metrics/adherence';
import { exerciseBests } from '@/src/metrics/pr';
import { addDays } from '@/src/metrics/dates';
import { displayDate, displayShortDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';
import { tonnageByWeek, totalTonnage } from '@/src/metrics/tonnage';
import { loadUnlockedAchievements, loadXpSummary } from '@/src/db/gamification';
import { signOut } from '../sign-in/actions';
import { startWorkout } from './actions';
import { BadgeReveal } from './BadgeReveal';

export const dynamic = 'force-dynamic';

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;

export default async function WorkoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ unlocked?: string }>;
}) {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const [history, workouts, badges, { unlocked }] = await Promise.all([
    loadHistory(db),
    listWorkouts(db),
    loadUnlockedAchievements(db),
    searchParams,
  ]);

  // INVARIANT: every number below is computed by src/metrics, never by a model
  //            — CLAUDE.md #1. This page only formats them.
  const today = localDateFor(user.timezone);
  const xp = await loadXpSummary(db, today);
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
            {user.timezone} · today is {displayDate(today)}
          </span>
        </div>
        <div className="row">
          <Link href="/progress" className="chip">
            Progress
          </Link>
          <Link href="/templates" className="chip">
            Templates
          </Link>
          <Link href="/coach" className="chip">
            Coach
          </Link>
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

      <BadgeReveal slug={unlocked} badges={badges} />

      <div className="grid cols-4">
        <div className="stat">
          <div className="label with-hint">
            Adherence · 4 wks
            <FieldHint title="Adherence">
              Sessions you kept, out of those that have come due in the last four weeks. A scheduled
              rest day counts as kept — resting on plan is following it. Sessions still in the
              future count neither way.
            </FieldHint>
          </div>
          <div className="value">
            {last7.rate === null ? '—' : `${Math.round(last7.rate * 100)}%`}
          </div>
          <div className="muted small">
            {last7.kept} of {last7.resolved} sessions
          </div>
        </div>
        <div className="stat">
          <div className="label with-hint">
            Streak
            <FieldHint title="Streak">
              Planned sessions kept in a row, counting back from today. Rest days keep it alive; a
              skipped session breaks it. Days with nothing scheduled are stepped over, so training
              every other day does not reset it.
            </FieldHint>
          </div>
          <div className="value">{streak}</div>
          <div className="muted small">
            <Link href="/progress">{xp.thisWeek} XP this week</Link>
          </div>
        </div>
        <div className="stat">
          <div className="label with-hint">
            This week
            <FieldHint title="Tonnage">
              Total load moved: weight × reps, warm-ups excluded. Bodyweight movements count as zero
              — there is no external load to measure, and estimating it would rewrite your past
              numbers every time your weight changed.
            </FieldHint>
          </div>
          <div className="value">{thisWeek ? kg(thisWeek[1]) : '—'}</div>
          <div className="muted small">{kg(totalTonnage(history.sets))} all time</div>
        </div>
        <div className="stat">
          <div className="label with-hint">
            Acute : chronic
            <FieldHint title="Acute : chronic">
              Your last 7 days of load divided by your last 28. Near 1.0 is steady, below 0.8 is a
              deload, and above 1.5 is a sharp spike — the range most associated with injury. Blank
              until a full 28 days sits behind you, because before that the number is meaningless.
            </FieldHint>
          </div>
          <div className="value">{load.ratio === null ? '—' : load.ratio.toFixed(2)}</div>
          <div className="muted small">
            {load.ratio === null
              ? `${load.chronicDaysCovered}/28 days of history`
              : acwrBand(load.ratio).replace('-', ' ')}
          </div>
        </div>
      </div>

      <h2 className="section with-hint">
        Weekly tonnage
        <FieldHint title="Weekly tonnage">
          Load moved per week, Monday to Sunday. The bar is scaled against your heaviest week, so it
          shows the shape of your training rather than an absolute amount.
        </FieldHint>
      </h2>
      <div className="card tonnage">
        {weekly.slice(-12).map(([week, value]) => (
          <div key={week} className="tonnage-row">
            <span className="muted small">{displayShortDate(week)}</span>
            <span className="bar">
              <span style={{ width: `${(value / peak) * 100}%` }} />
            </span>
            <span className="small tonnage-value">{kg(value)}</span>
          </div>
        ))}
        {weekly.length === 0 ? <p className="muted small">No sets logged yet.</p> : null}
      </div>

      <h2 className="section with-hint">
        Best estimated 1RM
        <FieldHint title="Estimated 1RM">
          What your best set suggests you could lift once, using the Epley formula: weight × (1 +
          reps ÷ 30). It is an estimate, not a test. Left blank above 12 reps, where the formula
          stops being trustworthy.
        </FieldHint>
      </h2>
      <div className="card">
        <table className="table-cards">
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
                <td data-label="Lift">
                  {history.exercises.get(b.exerciseId)?.name ?? b.exerciseId}
                </td>
                <td data-label="e1RM">{b.bestE1rm!.toFixed(1)} kg</td>
                <td data-label="Best set" className="muted">
                  {b.bestWeightKg} kg
                </td>
                <td data-label="When" className="muted small">
                  {displayDate(b.bestE1rmDate)}
                </td>
              </tr>
            ))}
            {topLifts.length === 0 ? (
              <tr>
                <td data-label="" colSpan={4} className="muted small">
                  Nothing estimable yet — Epley needs a loaded set of 12 reps or fewer.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2 className="section">Sessions</h2>
      <div className="card">
        <table className="table-cards">
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
                <td data-label="Date">
                  <Link href={`/workouts/${w.id}`}>{displayDate(w.localDate)}</Link>
                </td>
                <td data-label="Status">
                  <span className={`badge ${w.status}`}>{w.status.replace('_', ' ')}</span>
                </td>
                <td data-label="Sets" className="muted">
                  {w.setCount || '—'}
                </td>
                <td data-label="Notes" className="muted small">
                  {w.notes ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
