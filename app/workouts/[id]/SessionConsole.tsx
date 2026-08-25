'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { logSet } from '../actions';
import { FieldHint } from '@/src/ui/FieldHint';
import { RestTimer, type RestTrigger } from './RestTimer';
import { SessionTimer } from './SessionTimer';

export interface Candidate {
  id: string;
  name: string;
  movementPattern: string | null;
  primaryMuscle: string;
}

/**
 * WHY the picker filters in the browser rather than querying per keystroke: the
 * candidate list is already equipment-filtered in SQL before it reaches this
 * component (CLAUDE.md #5), so it is a few hundred rows at most. Searching them
 * locally is instant and costs no round trip. The security-relevant filtering
 * has already happened; this is only convenience on top of it.
 */
const MAX_RESULTS = 40;

function matches(candidate: Candidate, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  // Every term has to appear somewhere, so "db press" finds "Incline Dumbbell
  // Press" without the words being adjacent.
  return q
    .split(/\s+/)
    .every(
      (term) =>
        candidate.name.toLowerCase().includes(term) ||
        candidate.primaryMuscle.toLowerCase().includes(term) ||
        (candidate.movementPattern ?? '').includes(term)
    );
}

export function SessionConsole({
  workoutId,
  startedAt,
  candidates,
}: {
  workoutId: string;
  startedAt: string | null;
  candidates: Candidate[];
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restTrigger, setRestTrigger] = useState<RestTrigger | null>(null);
  const [pending, startTransition] = useTransition();

  const formRef = useRef<HTMLFormElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const results = useMemo(
    () => candidates.filter((c) => matches(c, query)).slice(0, MAX_RESULTS),
    [candidates, query]
  );

  const choose = (candidate: Candidate) => {
    setSelected(candidate);
    setQuery('');
    setOpen(false);
  };

  function handleSubmit(formData: FormData) {
    if (!selected) {
      setError('Pick an exercise first.');
      return;
    }
    setError(null);

    // Read before the action runs so the rest length is known even though the
    // form is reset immediately afterwards.
    const requested = Number(formData.get('restSeconds'));
    const restSeconds = Number.isFinite(requested) && requested > 0 ? requested : 120;

    startTransition(async () => {
      try {
        await logSet(formData);
        // Rest starts on its own — the whole point of logging a set is that you
        // are now resting, and reaching for a second button is the step people
        // skip when they are out of breath.
        setRestTrigger({ seconds: restSeconds, nonce: Date.now() });
        // Keep the exercise selected: the next set is almost always the same
        // lift. Only the numbers change.
        formRef.current?.reset();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not log that set.');
      }
    });
  }

  return (
    <>
      <div className="timer-grid">
        <SessionTimer startedAt={startedAt} />
        <RestTimer trigger={restTrigger} />
      </div>

      <h2 className="section">Add a set</h2>
      <div className="card">
        <form ref={formRef} action={handleSubmit} className="set-form">
          <input type="hidden" name="workoutId" value={workoutId} />
          <input type="hidden" name="exerciseId" value={selected?.id ?? ''} />

          <div className="f-exercise">
            <span className="label">Exercise · {candidates.length} available to you</span>

            {selected ? (
              <div className="chosen">
                <span className="chosen-name">{selected.name}</span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setSelected(null);
                    setOpen(true);
                    requestAnimationFrame(() => searchRef.current?.focus());
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="combo">
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  placeholder="Search — try “squat”, “db press”, “lats”"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                  }}
                  onFocus={() => setOpen(true)}
                  aria-expanded={open}
                  aria-controls="exercise-results"
                />
                {open ? (
                  <ul className="combo-list" id="exercise-results" role="listbox">
                    {results.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => choose(c)}>
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
          </div>

          <label className="f-num">
            <span className="label">Weight kg</span>
            <input name="weightKg" type="number" step="0.5" min="0" inputMode="decimal" />
          </label>

          <div className="f-num">
            <span className="label with-hint">
              <label htmlFor="field-reps">Reps</label>
              <FieldHint title="Reps">
                How many times you completed the movement in this set. Above 12 reps the e1RM
                estimate is left blank — the Epley formula stops being trustworthy that high.
              </FieldHint>
            </span>
            <input id="field-reps" name="reps" type="number" step="1" min="0" inputMode="numeric" />
          </div>

          <div className="f-num">
            <span className="label with-hint">
              <label htmlFor="field-rpe">RPE</label>
              <FieldHint title="RPE">
                Rate of Perceived Exertion, 1–10: how hard the set felt. 10 means you could not have
                done another rep, 9 means one more, 8 means two. Optional — leave it blank rather
                than guess.
              </FieldHint>
            </span>
            <input
              id="field-rpe"
              name="rpe"
              type="number"
              step="0.5"
              min="1"
              max="10"
              inputMode="decimal"
            />
          </div>

          <label className="f-num">
            <span className="label">Rest s</span>
            <input
              name="restSeconds"
              type="number"
              step="15"
              min="0"
              defaultValue={120}
              inputMode="numeric"
            />
          </label>

          <label className="f-check">
            <input name="isWarmup" type="checkbox" />
            <span>Warmup</span>
          </label>

          <div className="f-submit">
            <button type="submit" disabled={pending}>
              {pending ? 'Logging…' : 'Log set'}
            </button>
          </div>
        </form>

        {error ? <p className="error small">{error}</p> : null}
        {candidates.length === 0 ? (
          <p className="error small">
            No equipment recorded, so nothing can be prescribed. Seeded users have equipment; a new
            account needs rows in <code>user_equipment</code>.
          </p>
        ) : null}
      </div>
    </>
  );
}
