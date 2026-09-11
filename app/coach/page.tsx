import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { latestAcceptedPlan, listPersonas, personaVoice } from '@/src/db/personas';
import { displayDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';
import { planSessionOptions } from '@/src/templates/plan';
import { PlanImportForm } from '../workout/ImportForms';
import { CoachConsole, type CoachPersona } from './CoachConsole';
import { ChatPanel } from './ChatPanel';
import { DietPanel } from './DietPanel';
import { SupplementPanel } from './SupplementPanel';

export const dynamic = 'force-dynamic';

export default async function CoachPage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const [personaRows, plan] = await Promise.all([listPersonas(db), latestAcceptedPlan(db)]);

  const personas: CoachPersona[] = await Promise.all(
    personaRows.map(async (p) => ({ ...p, voice: await personaVoice(db, p.slug) }))
  );

  const weekLabels = (plan?.block.weeks ?? []).map(
    (w) => `Week ${w.week_number}${w.is_deload ? ' · deload' : ''}`
  );

  return (
    <>
      <header className="top">
        <div>
          {/* The tab is Coach, and the plan is one of two things on it now. */}
          <h1>Coach</h1>
          <span className="muted small">
            {plan ? `Plan accepted ${displayDate(plan.createdAt.slice(0, 10))}` : 'No plan yet'}
          </span>
        </div>
        {/*
         * One of two ways into /evidence — ADR 0023, and `OWNED_BY` in
         * src/ui/tabs.ts carries the route so the orphan-link guard in
         * tests/unit/invariants.test.ts can see it.
         *
         * WHY here rather than on Profile: a supplement question is a coaching
         * question that this coach cannot answer well.
         *
         * FOUND IN REVIEW: this said the chat "will decline to recommend a
         * supplement". ADR 0015 refuses to promise that — it calls topical
         * confinement "a judgement, not arithmetic", defence in depth rather
         * than a control. The link is somewhere better to send the user, not a
         * guarantee about what the model will say.
         */}
        <Link href="/evidence" className="chip">
          Supplements
        </Link>
      </header>

      {plan === null ? (
        <div className="card">
          {/*
           * No "Create a plan" button here, and the card says why instead of
           * offering one — docs/specs/coach-chat.md §1. A planner run is up to
           * three planner+critic round trips at 25 to 120 seconds each, which
           * does not fit in a serverless function, and making it fit means a
           * job queue that CLAUDE.md puts out of scope. A button that dead-ends
           * would be worse than this sentence.
           */}
          <p className="muted">
            No accepted plan yet. Plans are produced by the planner run, which has to pass the
            deterministic rules and the safety critic before anything appears here. You can still
            talk to your coach below.
          </p>
        </div>
      ) : (
        <>
          <CoachConsole personas={personas} weekLabels={weekLabels} />

          {/*
           * The plan is revealed, not served — the user's own request, and the
           * right default regardless: a twelve-week block unrolled on load is
           * most of a screen nobody asked for.
           *
           * A <details> rather than client state: it needs no JavaScript, it is
           * keyboard and screen-reader navigable for free, and with CSS off it
           * degrades to an open section rather than to a hidden one.
           */}
          <details className="plan-disclosure card">
            <summary>
              <span className="label">Show my plan</span>
              <span className="muted small">
                {plan.block.weeks.length} {plan.block.weeks.length === 1 ? 'week' : 'weeks'}
              </span>
            </summary>

            <div className="plan-body">
              <h2 className="section with-hint">
                The plan itself
                <FieldHint title="Where these numbers come from">
                  Every figure below was chosen by the planner and checked by deterministic rules
                  before the coach ever saw it. The coach can describe the plan; it cannot change a
                  number in it, and a number it states that is not here is rejected automatically.
                </FieldHint>
              </h2>

              {/*
               * A plan becomes a template — rework plan, PR 7. The same control
               * and the same action as /workout/new, so a session saved here is
               * the one saved there: copied verbatim from this block, and a
               * second copy gets a counter rather than a twin. Above the weeks,
               * not below them: a twelve-week block would bury it.
               */}
              <div className="card">
                <PlanImportForm
                  sessions={planSessionOptions(plan.block)}
                  submitLabel="Save as a template"
                />
              </div>

              {plan.block.weeks.map((week) => (
                <div key={week.week_number} className="card week-card">
                  <div className="row">
                    <span className="label">Week {week.week_number}</span>
                    {week.is_deload ? <span className="badge rest">deload</span> : null}
                  </div>

                  {week.sessions.map((session) => (
                    <div key={session.day_index} className="session-block">
                      <span className="muted small">
                        Day {session.day_index + 1} · {session.focus}
                      </span>
                      <table className="table-cards">
                        <thead>
                          <tr>
                            <th>Exercise</th>
                            <th>Sets</th>
                            <th>Reps</th>
                            <th>Weight</th>
                          </tr>
                        </thead>
                        <tbody>
                          {session.exercises.map((exercise) => {
                            const first = exercise.set_groups[0];
                            const totalSets = exercise.set_groups.reduce((n, g) => n + g.count, 0);
                            return (
                              <tr key={exercise.exercise_slug}>
                                <td data-label="Exercise">{exercise.exercise_slug}</td>
                                <td data-label="Sets">{totalSets}</td>
                                <td data-label="Reps">{first?.reps ?? '—'}</td>
                                <td data-label="Weight">
                                  {first?.weight_kg === null || first === undefined
                                    ? 'bodyweight'
                                    : `${first.weight_kg} kg`}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              ))}

              <h2 className="section">Why this plan</h2>
              <div className="card">
                {/* The planner's own rationale, not the persona's. Kept separate so
                it is obvious which text came from which stage. */}
                <p className="muted">{plan.block.rationale}</p>
              </div>
            </div>
          </details>
        </>
      )}

      {/*
       * ADR 0024. Below the plan and above the chat: it is a figure like the
       * plan is a figure, and the chat is the open-ended thing that belongs
       * last. It renders whether or not a plan exists — the target is computed
       * from Settings and the training log, not from a block.
       */}
      <h2 className="section">Eating</h2>
      <DietPanel />
      {/*
       * ADR 0023's table, asked rather than browsed — docs/PRD.md §5.7. Beside
       * the calorie target because they are the same question from two sides,
       * and the Supplements link in the header still goes to the whole table for
       * anyone who would rather read it than ask.
       */}
      <SupplementPanel />

      <ChatPanel />
    </>
  );
}
