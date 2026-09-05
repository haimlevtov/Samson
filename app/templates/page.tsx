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
import { startWorkout } from '../workouts/actions';
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

/**
 * The two places a template comes from, in the order they matter to the user.
 * `source` is a column — CLAUDE.md #7 — so this maps values to words rather
 * than inventing a taxonomy.
 */
const GROUPS = [
  {
    source: 'user' as const,
    label: 'My templates',
    empty: 'Nothing yet. Build one below, or save a session you liked.',
  },
  {
    source: 'coach' as const,
    label: "From the coach's plan",
    empty: 'Nothing imported yet. A plan the coach has produced can be imported below.',
  },
];

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
          <h1>Workout</h1>
          <span className="muted small">
            {templates.length === 0
              ? 'No templates yet — build one below'
              : `${templates.length} template${templates.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </header>

      {/*
       * Quick start, above the templates. Picking a template is how a session
       * normally begins — that is the whole feature — but an account with none
       * yet would be a dead end on its first day, and "walk in and start" stays
       * one tap for everyone else.
       */}
      <h2 className="section">Quick start</h2>
      <form action={startWorkout} className="start-empty">
        <button type="submit">Start an empty workout</button>
      </form>

      <h2 className="section with-hint">
        Templates
        <FieldHint title="What a template is">
          A named list of set groups — “3×5 at 60 kg” is one group. Starting it creates a session
          with those targets; nothing is logged until you actually lift, so a template can never add
          work you did not do to your tonnage or your records.
        </FieldHint>
      </h2>

      {/*
       * Grouped by where each one came from rather than by a folder the user
       * has to maintain. `source` is already on the row, it is already the
       * thing people sort by — mine versus the coach's — and a folder tree is
       * a schema change plus a management screen for a list this short.
       */}
      {GROUPS.map((group) => {
        const rows = templates.filter((t) => t.source === group.source);
        return (
          <section key={group.source} className="tpl-group">
            <h3 className="tpl-group-head">
              {group.label} <span className="muted">({rows.length})</span>
            </h3>

            {rows.length === 0 ? (
              <p className="card muted small">{group.empty}</p>
            ) : (
              <div className="tpl-grid">
                {rows.map((t) => (
                  <article key={t.id} className="card tpl-card">
                    <h4 className="tpl-name">
                      <Link href={`/templates/${t.id}`}>{t.name}</Link>
                    </h4>
                    <p className="muted small tpl-lifts">
                      {t.exercises.length === 0 ? 'Nothing prescribed' : t.exercises.join(', ')}
                    </p>
                    <p className="muted small tpl-meta">
                      {t.itemCount} set group{t.itemCount === 1 ? '' : 's'}
                    </p>
                    {/* The whole point of the feature: one tap to training. */}
                    <form action={startFromTemplate}>
                      <input type="hidden" name="templateId" value={t.id} />
                      <button type="submit">Start</button>
                    </form>
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}

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
