import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { loadPreviousSets, loadWorkout } from '@/src/db/training';
import { availableExercises } from '@/src/db/exercises';
import { loadTemplate } from '@/src/db/templates';
import { pendingTargets, templateProgress } from '@/src/templates/progress';
import { totalTonnage } from '@/src/metrics/tonnage';
import { loadChallenges } from '@/src/db/gamification';
import { logLine } from '@/src/llm/failure';
import { displayDate } from '@/src/ui/format';
import { Hex } from '@/src/ui/Hex';
import { Icon } from '@/src/ui/icons';
import { challengeTitle } from '@/src/ui/quests';
import { FinishForm } from './FinishForm';
import { SessionCoach } from './SessionCoach';
import { SessionConsole, type Candidate } from './SessionConsole';
import { SessionTimer } from './SessionTimer';

export const dynamic = 'force-dynamic';

export default async function WorkoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const workout = await loadWorkout(db, id);
  // RLS returns nothing for another user's workout, so "not mine" and "does not
  // exist" are the same 404 — no probing for valid ids.
  if (!workout) notFound();

  const editable = workout.status === 'in_progress' || workout.status === 'planned';

  /*
   * The quest this session counts toward, for the hint card under the bar — the
   * Quest Log's light coat. Only an ACCEPTED `sessions` challenge: finishing moves
   * a streak challenge too, but only a sessions quest is ABOUT a session.
   *
   * STARTED HERE and awaited below, alongside the page's other reads — FOUND IN
   * REVIEW: awaited on its own it added a round trip to every set tick, because
   * logging a set revalidates this page. Only while editable, and it DEGRADES: a
   * hint about a quest is not worth an error page mid-set. No progress figure
   * either; that would need the whole history.
   */
  const questRead = editable
    ? loadChallenges(db)
        .then(
          (all) =>
            all.find(
              (c) => c.status === 'active' && c.spec !== null && c.spec.kind === 'sessions'
            ) ?? null
        )
        .catch((cause: unknown) => {
          console.error('challenges unavailable', logLine(cause));
          return null;
        })
    : Promise.resolve(null);

  // INVARIANT: the picker is filtered in SQL by the equipment this user owns,
  //            before anything is rendered or, later, sent to a model — #5.
  const rows = await availableExercises(db, user.id);
  const candidates: Candidate[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    movementPattern: c.movementPattern,
    primaryMuscle: c.primaryMuscle,
  }));

  // What this lift went for last time — the number the next set is chosen from,
  // and the PREVIOUS column of the grid. ADR 0011.
  const previous = await loadPreviousSets(db, workout.id, workout.localDate);

  /*
   * The prescription, if this session was started from a template — ADR 0010.
   *
   * INVARIANT: no `sets` row exists for any of this. The targets render as
   *            pending rows (ADR 0011) and become sets only when the user ticks
   *            one, through the same `insertSet()` every other path uses.
   *
   * AI-NOTE: `items` arrives in ascending position and both calls below depend
   *          on that order. `loadTemplate` sorts; do not re-sort here.
   */
  const template = workout.templateId === null ? null : await loadTemplate(db, workout.templateId);
  const groups = (template?.items ?? []).map((item) => ({
    id: item.id,
    exerciseId: item.exerciseId,
    setCount: item.setCount,
    reps: item.reps,
    weightKg: item.weightKg,
    rpe: item.rpe,
    restSeconds: item.restSeconds,
  }));
  const targets = editable ? pendingTargets(groups, workout.sets) : [];
  const progress = template === null ? null : templateProgress(groups, workout.sets);

  const quest = await questRead;

  const working = workout.sets.filter((s) => !s.isWarmup);
  const tonnage = totalTonnage(
    workout.sets.map((s) => ({
      exerciseId: s.exerciseId,
      weightKg: s.weightKg,
      reps: s.reps,
      isWarmup: s.isWarmup,
      localDate: workout.localDate,
    }))
  );

  return (
    <>
      {/* Back, the clock with the session's name, and the way out, in one row that
          stays put while the grid scrolls under it. */}
      <div className="session-bar">
        <Link href="/history" className="bar-back" aria-label="All sessions">
          <Icon name="chevron-left" size={22} />
        </Link>
        {/* The clock over what this session is — its template, or its date. */}
        <span className="bar-center">
          <SessionTimer startedAt={workout.startedAt} endedAt={workout.endedAt} />
          {/* For the eye while the header has scrolled away; the header below says
              the same, so a screen reader hears it once. */}
          <span className="bar-label" aria-hidden="true">
            {template?.name ?? displayDate(workout.localDate)}
          </span>
        </span>
        {editable ? (
          <button type="submit" form="finish-session" className="bar-finish">
            Finish
          </button>
        ) : (
          <span className={`badge ${workout.status}`}>{workout.status.replace('_', ' ')}</span>
        )}
      </div>

      {editable ? (
        <p className="card quest-hint">
          <Hex size={34} tone="soft">
            <Icon name="dumbbell" size={17} />
          </Hex>
          <span>
            <strong>Finishing settles this session's XP.</strong>
            {quest === null ? null : (
              <>
                {' '}
                A finished day counts toward <em>{challengeTitle(quest.spec, quest.slug)}</em>.
              </>
            )}
          </span>
        </p>
      ) : null}

      <header className="top">
        <div>
          <h1>{displayDate(workout.localDate)}</h1>
          <span className="muted small">
            {working.length} working set{working.length === 1 ? '' : 's'} ·{' '}
            {Math.round(tonnage).toLocaleString()} kg
          </span>
          {/* The one derived number the template feature shows a user — ADR
              0010 — and this is the screen where it is actionable. */}
          {template === null || progress === null ? null : (
            <span className="muted small tpl-running">
              {template.name} · {progress.completedSets} of {progress.prescribedSets} prescribed
              {progress.extraSets > 0 ? ` · ${progress.extraSets} extra` : ''}
            </span>
          )}
        </div>
      </header>

      <SessionConsole
        workoutId={workout.id}
        logged={workout.sets}
        previous={previous}
        targets={targets}
        candidates={candidates}
        editable={editable}
      />

      {/*
       * Ask the coach — ADR 0031. Only while the session is EDITABLE: a finished
       * workout is a record being read, and "hold to talk" on a page about last
       * Tuesday is a control with nothing to be mid-session about.
       */}
      {editable ? <SessionCoach /> : null}

      {editable ? (
        <>
          <h2 className="section">Finish</h2>
          <div className="card">
            <FinishForm workoutId={workout.id} />
          </div>
        </>
      ) : null}

      {!editable && workout.notes ? (
        <>
          <h2 className="section">Notes</h2>
          {/* Rendered as text, never as instructions — CLAUDE.md #11. */}
          <div className="card">{workout.notes}</div>
        </>
      ) : null}
    </>
  );
}
