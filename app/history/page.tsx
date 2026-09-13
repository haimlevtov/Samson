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
  /*
   * Degrades rather than throws — FOUND IN REVIEW, 2026-09-07.
   *
   * This query exists to remove ONE row from the list. History is also the
   * recovery surface for every session that falls outside the active window,
   * so letting a transient failure here take the page down means the screen
   * somebody reaches for when something already went wrong is the screen that
   * breaks. Showing the running session in History for one render is strictly
   * better than showing nothing.
   */
  const active = await activeWorkout(db).catch(() => null);

  const [workouts, { unlocked }] = await Promise.all([
    listWorkouts(db, 40, active?.id ?? null),
    searchParams,
  ]);
  /*
   * Only when a badge might fire, and degrading like the active-session read
   * above — FOUND IN REVIEW. This was read on every visit and could take the
   * whole list down for the sake of a sheet that shows once.
   */
  const badges = unlocked === undefined ? [] : await loadUnlockedAchievements(db).catch(() => []);
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

      {/* Finishing a session lands on its receipt, where a badge fires now. This
          still reveals one for a ?unlocked= link — the same sheet, the same gate. */}
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
