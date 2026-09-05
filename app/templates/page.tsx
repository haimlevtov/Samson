import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { listTemplates } from '@/src/db/templates';
import { availableExercises } from '@/src/db/exercises';
import { listWorkouts } from '@/src/db/training';
import { latestAcceptedPlan } from '@/src/db/personas';
import { plannedSessionName } from '@/src/templates/plan';
import { displayDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';
import { startFromTemplate } from './actions';
import { TemplateBuilder, type PickerExercise } from './TemplateBuilder';
import {
  PlanImportForm,
  SessionImportForm,
  type PlanSessionOption,
  type SessionOption,
} from './ImportForms';

export const dynamic = 'force-dynamic';

/** How far back the "save a session" picker looks. Recent enough to remember. */
const RECENT_SESSIONS = 10;

export default async function TemplatesPage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const [templates, exercises, workouts, plan] = await Promise.all([
    listTemplates(db),
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

  const planSessions: PlanSessionOption[] = (plan?.block.weeks ?? []).flatMap((week) =>
    week.sessions.map((session) => ({
      weekNumber: week.week_number,
      dayIndex: session.day_index,
      // The same label the import itself will store — src/templates/plan.ts.
      label: plannedSessionName(week.week_number, session),
    }))
  );

  return (
    <>
      <header className="top">
        <div>
          <h1>Templates</h1>
          <span className="muted small">
            {templates.length === 0
              ? 'A session you can start with one tap'
              : `${templates.length} saved`}
          </span>
        </div>
        <div className="row">
          <Link href="/coach" className="chip">
            Coach
          </Link>
          <Link href="/workouts" className="chip">
            ← Sessions
          </Link>
        </div>
      </header>

      <div className="card">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Template</th>
              <th>From</th>
              <th>Groups</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td data-label="Template">
                  <Link href={`/templates/${t.id}`}>{t.name}</Link>
                </td>
                <td data-label="From">
                  <span className="badge">{t.source}</span>
                </td>
                <td data-label="Groups" className="muted">
                  {t.itemCount}
                </td>
                <td data-label="">
                  {/* The whole point of the feature: one tap to training. */}
                  <form action={startFromTemplate}>
                    <input type="hidden" name="templateId" value={t.id} />
                    <button type="submit">Start</button>
                  </form>
                </td>
              </tr>
            ))}
            {templates.length === 0 ? (
              <tr>
                <td data-label="" colSpan={4} className="muted small">
                  No templates yet. Build one below, save a session you liked, or import a day from
                  the coach&rsquo;s plan.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2 className="section with-hint">
        Build one
        <FieldHint title="What a template is">
          A named list of set groups — “3×5 at 60 kg” is one group. Starting it creates a session
          with those targets; nothing is logged until you actually lift, so a template can never add
          work you did not do to your tonnage or your records.
        </FieldHint>
      </h2>
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
