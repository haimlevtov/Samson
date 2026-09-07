import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { activeWorkout, listWorkouts } from '@/src/db/training';
import { loadUnlockedAchievements } from '@/src/db/gamification';
import { displayDate } from '@/src/ui/format';
import { BadgeReveal } from './BadgeReveal';

export const dynamic = 'force-dynamic';

/**
 * History — ADR 0012.
 *
 * Past sessions, and nothing else. The stat tiles, the tonnage chart, the
 * best-e1RM table, "Start workout" and "Sign out" all used to live here; they
 * are now on Hub, Workout and Profile respectively. This page ranks 3 in
 * docs/specs/mobile-interface.md §2 — nobody opens it mid-set.
 *
 * The route keeps its name because `/history/[id]` is the session screen, and
 * renaming that to match a tab label would buy nothing.
 */
export default async function WorkoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ unlocked?: string }>;
}) {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const today = localDateFor(user.timezone);

  // The session being performed right now is not history yet — ADR 0012 says
  // this page owns past sessions and nothing else, and a workout you are still
  // logging into is not one.
  const active = await activeWorkout(db, today);

  const [workouts, badges, { unlocked }] = await Promise.all([
    listWorkouts(db, 40, active?.id ?? null),
    loadUnlockedAchievements(db),
    searchParams,
  ]);
  const logged = workouts.filter((w) => w.setCount > 0).length;

  return (
    <>
      <header className="top">
        <div>
          <h1>History</h1>
          <span className="muted small">
            {logged} session{logged === 1 ? '' : 's'} with work in them · today is{' '}
            {displayDate(today)}
          </span>
        </div>
      </header>

      {/* Finishing a session redirects here with ?unlocked=, so the badge fires
          on the screen you land on. */}
      <BadgeReveal slug={unlocked} badges={badges} />

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
                  <Link href={`/history/${w.id}`}>{displayDate(w.localDate)}</Link>
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
            {workouts.length === 0 ? (
              <tr>
                <td data-label="" colSpan={4} className="muted small">
                  Nothing yet. Start one from the Workout tab.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
