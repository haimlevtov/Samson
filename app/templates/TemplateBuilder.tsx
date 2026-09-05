'use client';

import { useActionState, useMemo, useState } from 'react';
import { createUserTemplate } from './actions';
import { EMPTY_TEMPLATE_FORM, type TemplateFormState } from './form-state';
import { MAX_TEMPLATE_ITEMS, type TemplateItemDraft } from '@/src/templates/schema';

/**
 * WHY this type is declared here rather than imported from the session screen:
 * the two pickers want the same four fields, and importing across surfaces
 * would tie this page's build to a component that is being reshaped for
 * reasons of its own. Four field names are cheaper than that coupling.
 */
export interface PickerExercise {
  id: string;
  name: string;
  movementPattern: string | null;
  primaryMuscle: string;
}

/** A row being edited. The numbers are strings until they are submitted. */
interface DraftRow {
  key: string;
  exerciseId: string;
  exerciseName: string;
  setCount: string;
  reps: string;
  weightKg: string;
  restSeconds: string;
}

const MAX_RESULTS = 40;

/**
 * The same search the session picker uses: every term must appear somewhere, so
 * "db press" finds "Incline Dumbbell Press" without the words being adjacent.
 */
function matches(candidate: PickerExercise, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return q
    .split(/\s+/)
    .every(
      (term) =>
        candidate.name.toLowerCase().includes(term) ||
        candidate.primaryMuscle.toLowerCase().includes(term) ||
        (candidate.movementPattern ?? '').includes(term)
    );
}

/** Blank stays blank: an empty weight is bodyweight, which is not zero. */
function optionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function toDraft(row: DraftRow): TemplateItemDraft {
  return {
    exerciseId: row.exerciseId,
    setCount: Number(row.setCount),
    reps: Number(row.reps),
    weightKg: optionalNumber(row.weightKg),
    // RPE is deliberately not offered here — it is an instruction the user
    // rarely wants and always mistakes for a record of effort. ADR 0010's
    // deriver drops it for the same reason.
    rpe: null,
    restSeconds: optionalNumber(row.restSeconds),
  };
}

export function TemplateBuilder({ candidates }: { candidates: PickerExercise[] }) {
  const [state, action, pending] = useActionState<TemplateFormState, FormData>(
    createUserTemplate,
    EMPTY_TEMPLATE_FORM
  );

  const [rows, setRows] = useState<DraftRow[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const results = useMemo(
    () => candidates.filter((c) => matches(c, query)).slice(0, MAX_RESULTS),
    [candidates, query]
  );

  const add = (candidate: PickerExercise) => {
    setRows((current) => [
      ...current,
      {
        // Date.now() alone collides when two rows are added in the same tick.
        key: `${candidate.id}-${current.length}-${Date.now()}`,
        exerciseId: candidate.id,
        exerciseName: candidate.name,
        // Defaults that are a reasonable working set rather than a guess at
        // this user's programme. Every one of them is editable in place.
        setCount: '3',
        reps: '5',
        weightKg: '',
        restSeconds: '120',
      },
    ]);
    setQuery('');
    setOpen(false);
  };

  const update = (key: string, field: keyof DraftRow, value: string) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, [field]: value } : r)));

  const remove = (key: string) => setRows((current) => current.filter((r) => r.key !== key));

  const full = rows.length >= MAX_TEMPLATE_ITEMS;

  return (
    <form action={action} className="card">
      <input type="hidden" name="items" value={JSON.stringify(rows.map(toDraft))} />

      <label>
        <span className="label">Name</span>
        <input name="name" placeholder="Push day A" maxLength={80} required />
      </label>

      <h3 className="section">Exercises</h3>

      <table className="table-cards">
        <thead>
          <tr>
            <th>Exercise</th>
            <th>Sets</th>
            <th>Reps</th>
            <th>Weight kg</th>
            <th>Rest s</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td data-label="Exercise">{row.exerciseName}</td>
              <td data-label="Sets">
                <input
                  type="number"
                  min="1"
                  max="20"
                  step="1"
                  inputMode="numeric"
                  value={row.setCount}
                  aria-label={`Sets of ${row.exerciseName}`}
                  onChange={(e) => update(row.key, 'setCount', e.target.value)}
                />
              </td>
              <td data-label="Reps">
                <input
                  type="number"
                  min="1"
                  max="50"
                  step="1"
                  inputMode="numeric"
                  value={row.reps}
                  aria-label={`Reps of ${row.exerciseName}`}
                  onChange={(e) => update(row.key, 'reps', e.target.value)}
                />
              </td>
              <td data-label="Weight kg">
                <input
                  type="number"
                  min="0"
                  max="500"
                  step="0.5"
                  inputMode="decimal"
                  placeholder="bodyweight"
                  value={row.weightKg}
                  aria-label={`Weight for ${row.exerciseName}`}
                  onChange={(e) => update(row.key, 'weightKg', e.target.value)}
                />
              </td>
              <td data-label="Rest s">
                <input
                  type="number"
                  min="0"
                  max="900"
                  step="15"
                  inputMode="numeric"
                  value={row.restSeconds}
                  aria-label={`Rest after ${row.exerciseName}`}
                  onChange={(e) => update(row.key, 'restSeconds', e.target.value)}
                />
              </td>
              <td data-label="">
                <button type="button" className="secondary" onClick={() => remove(row.key)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td data-label="" colSpan={6} className="muted small">
                Nothing added yet. Search below — a template needs at least one exercise.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {full ? (
        <p className="muted small">
          That is the {MAX_TEMPLATE_ITEMS} set groups a template can hold. Remove one to add
          another.
        </p>
      ) : (
        <div className="combo">
          <span className="label">Add an exercise · {candidates.length} available to you</span>
          <input
            type="search"
            value={query}
            placeholder="Search — try “squat”, “db press”, “lats”"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="template-exercise-results"
          />
          {open ? (
            <ul className="combo-list" id="template-exercise-results" role="listbox">
              {results.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => add(c)}>
                    <span>{c.name}</span>
                    <span className="muted small">
                      {c.movementPattern ?? '—'} · {c.primaryMuscle}
                    </span>
                  </button>
                </li>
              ))}
              {results.length === 0 ? (
                <li className="muted small combo-empty">
                  Nothing matches. Only equipment you own is listed.
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      )}

      <label>
        <span className="label">Notes (optional)</span>
        <input name="notes" maxLength={500} placeholder="Warm up the shoulders first" />
      </label>

      {state.error ? <p className="error small">{state.error}</p> : null}

      <button type="submit" disabled={pending || rows.length === 0}>
        {pending ? 'Saving…' : 'Save template'}
      </button>
    </form>
  );
}
