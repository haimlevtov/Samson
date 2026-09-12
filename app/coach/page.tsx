import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { latestAcceptedPlan, listPersonas } from '@/src/db/personas';
import { openingCoach } from '@/src/persona/choice';
import { hasApiKey } from '@/src/llm/config';
import { normaliseGoal } from '@/src/diet/energy';
import { displayDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';
import { planSessionOptions } from '@/src/templates/plan';
import { PlanImportForm } from '../workout/ImportForms';
import { CoachConsole } from './CoachConsole';
import { CoachBox } from './CoachBox';
import { PlanRequestForm } from './PlanRequestForm';

export const dynamic = 'force-dynamic';

/**
 * The planner run happens in a server action on this route, and its ceiling is
 * the whole subject of ADR 0027. Stated here rather than inherited from a
 * platform default, because the default is the binding constraint on the one
 * feature this page's most argued-over control depends on.
 *
 * AI-NOTE: this and `WEB_PLAN_DEADLINE_MS` are two halves of one fact. The gap
 *          between them is the bookkeeping's — reading history, building the
 *          context, a ledger row per attempt, and the plan_runs row at the end.
 *          Change both together and keep the gap.
 */
export const maxDuration = 60;

export default async function CoachPage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const [personas, plan] = await Promise.all([listPersonas(db), latestAcceptedPlan(db)]);

  const voicedSlugs = personas.filter((p) => p.voiced).map((p) => p.slug);
  const chatVoiceSlug = openingCoach(voicedSlugs, user.personaSlug);
  const chatVoiceName = personas.find((p) => p.voiced && p.slug === chatVoiceSlug)?.name ?? null;

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
        /*
         * The questionnaire — rework PR 8b, ADR 0027.
         *
         * This card used to explain why there was NO button, and the explanation
         * was right about the arithmetic: three planner+critic rounds at their
         * configured timeouts is 540s against a 60s function ceiling. The button
         * exists on a stakeholder decision taken with the limits named, and what
         * makes it fit is a budget rather than optimism — one iteration, a
         * four-week block, and a deadline enforced inside the loop.
         *
         * It renders no Voice card, which is how it already worked: a coach with
         * no plan has nothing to deliver.
         */
        <PlanRequestForm />
      ) : (
        <>
          {/*
           * ADR 0025: with no key there is nothing that can speak a coach, so
           * the card shows each line as text rather than a button that cannot
           * speak (docs/specs/mobile-interface.md §4). Only the yes or no
           * crosses to the browser, never the key.
           */}
          <CoachConsole
            personas={personas}
            chosenSlug={user.personaSlug}
            weekLabels={weekLabels}
            voiceAvailable={hasApiKey()}
          />

          {/*
           * The plan is revealed, not served — the user's own request, and the
           * right default regardless: an eight-week block unrolled on load is
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
               * not below them: an eight-week block would bury it.
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
       * One box — rework PR 8a, ADR 0015 §6. It replaces the chat panel, the
       * diet panel's question and the supplement card: the user asks, and the
       * route decides which of the three answers they get.
       *
       * It renders whether or not a plan exists. The calorie target is computed
       * from Settings and the training log rather than from a block, and a
       * question about training is worth answering for somebody who has not been
       * given a plan yet — arguably more so.
       *
       * ADR 0023's table is still linked from the header for anyone who would
       * rather read it than ask.
       */}
      {/* The stored goal, so the selector opens where the user left it — ADR
          0032 §3. `normaliseGoal` handles a null or an unrecognised value. */}
      {/*
       * The voice the chat would speak in, named on the switch BEFORE it is
       * turned on. Resolved exactly as `performReply` resolves it — the stored
       * coach against the shared voiced rows, the first of them otherwise — so
       * the label cannot name a different coach from the one that speaks.
       */}
      <CoachBox goal={normaliseGoal(user.dietGoal ?? '')} voiceName={chatVoiceName} />
    </>
  );
}
