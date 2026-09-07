import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { loadTemplate } from '@/src/db/templates';
import { activeWorkout } from '@/src/db/training';
import { removeTemplate, startFromTemplate } from '../actions';

export const dynamic = 'force-dynamic';

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  // Same degradation as the templates list: a failure here must not take the
  // page down, and offering Start is wrong-but-usable rather than blank.
  const [template, active] = await Promise.all([
    loadTemplate(db, id),
    activeWorkout(db).catch(() => null),
  ]);
  // RLS returns nothing for another user's template, so "not mine" and "does
  // not exist" are the same 404 — no probing for valid ids.
  if (!template) notFound();

  const totalSets = template.items.reduce((n, item) => n + item.setCount, 0);

  return (
    <>
      <header className="top">
        <div>
          <h1>{template.name}</h1>
          <span className="muted small">
            <span className="badge">{template.source}</span> · {template.items.length} group
            {template.items.length === 1 ? '' : 's'} · {totalSets} set
            {totalSets === 1 ? '' : 's'}
          </span>
        </div>
        <div className="row">
          {/*
           * Not offered while a session is running — the action would redirect
           * into that session rather than start this template, and a button
           * labelled "Start workout" that lands you somewhere else is the app
           * lying about what it did. FOUND IN REVIEW, 2026-09-07: this page
           * did not read the active session at all.
           */}
          {active === null ? (
            <form action={startFromTemplate}>
              <input type="hidden" name="templateId" value={template.id} />
              <button type="submit">Start workout</button>
            </form>
          ) : (
            <Link href={`/history/${active.id}`}>Resume your session</Link>
          )}
          <Link href="/workout" className="chip">
            ← Templates
          </Link>
        </div>
      </header>

      <div className="card">
        <div className="table-scroll">
          <table className="table-cards">
            <thead>
              <tr>
                <th>#</th>
                <th>Exercise</th>
                <th>Sets</th>
                <th>Reps</th>
                <th>Weight</th>
                <th>Rest</th>
              </tr>
            </thead>
            <tbody>
              {template.items.map((item, index) => (
                <tr key={item.id}>
                  <td data-label="#" className="muted">
                    {index + 1}
                  </td>
                  <td data-label="Exercise">{item.exerciseName}</td>
                  <td data-label="Sets">{item.setCount}</td>
                  <td data-label="Reps">{item.reps}</td>
                  {/* Null weight is bodyweight — the absence of external load,
                      which is not the same claim as a load of zero. */}
                  <td data-label="Weight">
                    {item.weightKg === null ? 'bodyweight' : `${item.weightKg} kg`}
                  </td>
                  <td data-label="Rest" className="muted">
                    {item.restSeconds === null ? '—' : `${item.restSeconds}s`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {template.notes ? (
        <>
          <h2 className="section">Notes</h2>
          {/* Rendered as text, never as instructions — CLAUDE.md #11. */}
          <div className="card">{template.notes}</div>
        </>
      ) : null}

      <h2 className="section">Delete</h2>
      <div className="card">
        <p className="muted small">
          Sessions you have already run from this template keep their history. They stop showing it
          as their source, and nothing you logged is touched.
        </p>
        <form action={removeTemplate}>
          <input type="hidden" name="templateId" value={template.id} />
          <button type="submit" className="secondary">
            Delete template
          </button>
        </form>
      </div>
    </>
  );
}
