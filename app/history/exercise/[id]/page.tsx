import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerDb, currentUser } from '@/src/db/server';
import { loadExerciseHistory } from '@/src/db/training';
import { exerciseProgression } from '@/src/metrics/progression';
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

  const points = exerciseProgression(history.sets, id);

  return (
    <>
      <header className="top">
        <div>
          <h1>{history.name}</h1>
          <span className="muted small">
            {points.length === 0
              ? 'No working sets logged'
              : `${points.length} ${points.length === 1 ? 'session' : 'sessions'}`}
          </span>
        </div>
        <div className="row">
          <Link href="/history" className="chip">
            Back
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

      <LiftChart points={points} />
    </>
  );
}
