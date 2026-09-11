import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { availableExercises } from '@/src/db/exercises';
import { listWorkouts } from '@/src/db/training';
import { latestAcceptedPlan } from '@/src/db/personas';
import { planSessionOptions } from '@/src/templates/plan';
import { displayDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';
import { TemplateBuilder, type PickerExercise } from '../TemplateBuilder';
import { PlanImportForm, SessionImportForm, type SessionOption } from '../ImportForms';

export const dynamic = 'force-dynamic';

/** How far back the "save a session" picker looks. Recent enough to remember. */
const RECENT_SESSIONS = 10;

/**
 * The three ways to make a template, on their own screen.
 *
 * WHY not on the Workout tab where they started: they made that tab four
 * screens long, and every one of those screens sat between the user and the
 * button they open the app to press. Creating a template is a thing you do
 * once, sitting down. The tab is for starting one.
 *
 * All three end in `createTemplate()` and none of them writes a `sets` row —
 * ADR 0010.
 */
export default async function NewTemplatePage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const [exercises, workouts, plan] = await Promise.all([
    // INVARIANT: the picker is filtered in SQL by the equipment this user owns
    //            — CLAUDE.md #5, the same call the session screen makes.
    availableExercises(db, user.id),
    listWorkouts(db),
    latestAcceptedPlan(db),
  ]);

  const candidates: PickerExercise[] = exercises.map((c) => ({
    id: c.id,
    name: c.name,
    movementPattern: c.movementPattern,
    primaryMuscle: c.primaryMuscle,
  }));

  // A session with no sets has nothing to prescribe, so it is not offered.
  const sessions: SessionOption[] = workouts
    .filter((w) => w.status === 'completed' && w.setCount > 0)
    .slice(0, RECENT_SESSIONS)
    .map((w) => ({
      id: w.id,
      label: `${displayDate(w.localDate)} · ${w.setCount} set${w.setCount === 1 ? '' : 's'}`,
    }));

  // The same builder /coach uses, labelled with the name the import starts from;
  // a second import of a session adds a counter to it.
  const planSessions = planSessionOptions(plan?.block);

  return (
    <>
      <header className="top">
        <div>
          <h1>New template</h1>
          <span className="muted small">Build one, or copy one you already have</span>
        </div>
        <Link href="/workout" className="chip">
          ← Workout
        </Link>
      </header>

      <h2 className="section">Build one</h2>
      <TemplateBuilder candidates={candidates} />

      <h2 className="section">From a session you already did</h2>
      <div className="card">
        <SessionImportForm sessions={sessions} />
      </div>

      <h2 className="section with-hint">
        From the coach&rsquo;s plan
        <FieldHint title="Where these numbers come from">
          Every figure is copied from a plan the planner produced and the deterministic rules and
          safety critic both passed. Importing calls no model and changes no number.
        </FieldHint>
      </h2>
      <div className="card">
        <PlanImportForm sessions={planSessions} />
      </div>
    </>
  );
}
