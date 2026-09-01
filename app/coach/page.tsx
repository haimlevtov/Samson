import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { latestAcceptedPlan, listPersonas, personaVoice } from '@/src/db/personas';
import { displayDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';
import { CoachConsole, type CoachPersona } from './CoachConsole';

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
          <h1>Your plan</h1>
          <span className="muted small">
            {plan ? `Accepted ${displayDate(plan.createdAt.slice(0, 10))}` : 'No plan yet'}
          </span>
        </div>
        <Link href="/workouts">← Sessions</Link>
      </header>

      {plan === null ? (
        <div className="card">
          <p className="muted">
            No accepted plan yet. A plan appears here once the planner has produced one that passes
            both the deterministic rules and the safety critic.
          </p>
        </div>
      ) : (
        <>
          <CoachConsole personas={personas} weekLabels={weekLabels} />

          <h2 className="section with-hint">
            The plan itself
            <FieldHint title="Where these numbers come from">
              Every figure below was chosen by the planner and checked by deterministic rules before
              the coach ever saw it. The coach can describe the plan; it cannot change a number in
              it, and a number it states that is not here is rejected automatically.
            </FieldHint>
          </h2>

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
                        const first = exercise.sets[0];
                        return (
                          <tr key={exercise.exercise_slug}>
                            <td data-label="Exercise">{exercise.exercise_slug}</td>
                            <td data-label="Sets">{exercise.sets.length}</td>
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
        </>
      )}
    </>
  );
}
