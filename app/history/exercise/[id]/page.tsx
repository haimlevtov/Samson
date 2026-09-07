import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerDb, currentUser } from '@/src/db/server';
import { loadExerciseHistory } from '@/src/db/training';
import { exerciseProgression, progressionView } from '@/src/metrics/progression';
import { LiftChart } from '@/src/ui/LiftChart';
import { FieldHint } from '@/src/ui/FieldHint';

export const dynamic = 'force-dynamic';

/**
 * One lift's progression — ADR 0014.
 *
 * Its own route rather than an expander on the session screen: an inline chart
 * would make that page load progression data for every exercise in the session
 * on the chance one is opened, on the screen most likely to be live on a phone
 * mid-set. This loads one lift when somebody asks for it, and gets back
 * navigation and the full width in exchange.
 *
 * INVARIANT: every number below is computed by src/metrics — CLAUDE.md #1.
 *            This page loads rows and formats what the engine returns.
 */
export default async function ExerciseProgressionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const { id } = await params;
  const history = await loadExerciseHistory(db, id);

  // RLS already scoped the read, so a missing row means the exercise does not
  // exist or is not visible to this user — the same answer either way.
  if (history === null) notFound();

  /*
   * Trimmed twice, for two different reasons. The read is capped, so older
   * sessions may exist that were never fetched — and because a set cap can cut
   * mid-session, the oldest day present may be missing its heavier sets and is
   * dropped rather than drawn as a dip nobody trained. On top of that a chart
   * stops being readable past a certain number of points, whatever was read.
   * Both live in src/metrics so they are tested rather than sliced in JSX.
   */
  const view = progressionView(exerciseProgression(history.sets, id), history.truncated);

  return (
    <>
      <header className="top">
        <div>
          <h1>{history.name}</h1>
          <span className="muted small">
            {view.points.length === 0
              ? 'No working sets logged'
              : `${view.points.length} ${view.points.length === 1 ? 'session' : 'sessions'}` +
                (view.hidden > 0 ? ', most recent' : '')}
          </span>
        </div>
        <div className="row">
          {/* Named for where it goes. The entry point is the chart icon on a
              session screen, which may be a live one — "Back" would promise to
              return there, and this returns to the list. */}
          <Link href="/history" className="chip">
            All sessions
          </Link>
        </div>
      </header>

      <h2 className="section with-hint">
        Top set over time
        <FieldHint title="What this plots">
          The heaviest working set each time you trained this lift, with the reps beside it.
          Warm-ups are left out — a light first set is not a statement about how strong you are.
          Reps matter because weight alone reads a deload as a decline: 60 × 12 after 80 × 5 is a
          lighter week on purpose, not a step backwards.
        </FieldHint>
      </h2>

      <LiftChart points={view.points} hidden={view.hidden} />
    </>
  );
}
