import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { activeWorkout } from '@/src/db/training';
import { listTemplates } from '@/src/db/templates';
import { FieldHint } from '@/src/ui/FieldHint';
import { startWorkout } from '../history/actions';
import { startFromTemplate } from './actions';

export const dynamic = 'force-dynamic';

/**
 * The two places a template comes from, in the order they matter to the user.
 * `source` is a column — CLAUDE.md #7 — so this maps values to words rather
 * than inventing a taxonomy.
 */
const GROUPS = [
  {
    source: 'user' as const,
    label: 'My templates',
    empty: 'Nothing yet. Build one, or save a session you liked.',
  },
  {
    source: 'coach' as const,
    label: "From the coach's plan",
    empty: 'Nothing imported yet. A plan the coach has produced can be imported.',
  },
];

/**
 * The Workout tab — ADR 0012.
 *
 * Two things and no more: start something, or pick a template. The three ways
 * to *create* a template used to sit under this list and made the tab four
 * screens long; they are one tap away at `/workout/new` instead. Creating a
 * template is a thing you do once, at a desk. Starting one is a thing you do
 * standing up, every session.
 */
export default async function TemplatesPage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  // Same reasoning as History: an activeWorkout failure inside this
  // Promise.all would discard the templates with it and take the whole Workout
  // tab down. Falling back to null offers Start, which is wrong-but-usable
  // rather than blank.
  const [templates, active] = await Promise.all([
    listTemplates(db),
    activeWorkout(db).catch(() => null),
  ]);

  return (
    <>
      <header className="top">
        <div>
          <h1>Workout</h1>
          <span className="muted small">
            {templates.length === 0
              ? 'No templates yet'
              : `${templates.length} template${templates.length === 1 ? '' : 's'}`}
          </span>
        </div>
      </header>

      {/*
       * A session in progress owns this whole section. Starting anything else
       * would only redirect back here — the actions enforce one at a time — and
       * offering "Start" while one is running invites the user to think the
       * first one was lost.
       */}
      {active === null ? (
        <>
          {/*
           * Quick start, above the templates. Picking a template is how a
           * session normally begins — that is the whole feature — but an
           * account with none yet would be a dead end on its first day, and
           * "walk in and start" stays one tap for everyone else.
           */}
          <h2 className="section">Quick start</h2>
          <form action={startWorkout} className="start-empty">
            <button type="submit">Start an empty workout</button>
          </form>
        </>
      ) : (
        <>
          <h2 className="section">In progress</h2>
          <Link href={`/history/${active.id}`} className="resume">
            <span className="resume-label">Resume your session</span>
            <span className="muted small">It stays out of History until you finish it.</span>
          </Link>
        </>
      )}

      <div className="section-row">
        <h2 className="section with-hint">
          Templates
          <FieldHint title="What a template is">
            A named list of set groups — “3×5 at 60 kg” is one group. Starting it creates a session
            with those targets; nothing is logged until you actually lift, so a template can never
            add work you did not do to your tonnage or your records.
          </FieldHint>
        </h2>
        <Link href="/workout/new" className="chip">
          + New template
        </Link>
      </div>

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
                      <Link href={`/workout/${t.id}`}>{t.name}</Link>
                    </h4>
                    <p className="muted small tpl-lifts">
                      {t.exercises.length === 0 ? 'Nothing prescribed' : t.exercises.join(', ')}
                    </p>
                    <p className="muted small tpl-meta">
                      {t.itemCount} set group{t.itemCount === 1 ? '' : 's'}
                    </p>
                    {/*
                     * The whole point of the feature: one tap to training —
                     * but not while a session is running. The actions redirect
                     * rather than insert, so a Start here would silently land
                     * the user in a DIFFERENT session from the template they
                     * tapped, with nothing on the destination to explain it.
                     * The "Resume your session" block above is the one call to
                     * action while that is true; the template stays reachable
                     * through its own name.
                     */}
                    {active === null ? (
                      <form action={startFromTemplate}>
                        <input type="hidden" name="templateId" value={t.id} />
                        <button type="submit">Start</button>
                      </form>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
