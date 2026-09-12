'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { LoggedSet, PreviousSet, PreviousSets } from '@/src/db/training';
import type { TargetRow } from '@/src/templates/progress';
import { deleteSet, logSet } from '../actions';
import { LiftBlock, type LiftGroup } from './LiftBlock';
import { QuickLog } from './QuickLog';
import { RestTimer, type RestTrigger } from './RestTimer';
import {
  DEFAULT_REST_SECONDS,
  EMPTY_DRAFT,
  isTargetKey,
  newRow,
  readDraft,
  writeDraft,
  type DraftRow,
  type SessionDraft,
} from './session-draft';

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

/**
 * The session screen — one set grid per exercise, ADR 0011.
 *
 * Performed sets come from the server on every render. Pending rows are held
 * here and in localStorage, and become `sets` rows only when their tick is
 * pressed. Nothing is written optimistically: a row turns green because the
 * server said so, never because the user tapped — interface spec §4.
 */
export function SessionConsole({
  workoutId,
  logged,
  previous,
  targets,
  candidates,
  editable,
}: {
  workoutId: string;
  logged: LoggedSet[];
  previous: Record<string, PreviousSets>;
  /** What the session's template still asks for — ADR 0010. Empty without one. */
  targets: TargetRow[];
  candidates: Candidate[];
  editable: boolean;
}) {
  const [draft, setDraft] = useState<SessionDraft>(EMPTY_DRAFT);
  const [restored, setRestored] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restTrigger, setRestTrigger] = useState<RestTrigger | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [, startTransition] = useTransition();

  const searchRef = useRef<HTMLInputElement>(null);

  // Read after mount, not during render: the server has no localStorage, and a
  // draft restored during render would not match the HTML it sent.
  useEffect(() => {
    setDraft(readDraft(workoutId));
    setRestored(true);
  }, [workoutId]);

  useEffect(() => {
    if (restored) writeDraft(workoutId, draft);
  }, [restored, workoutId, draft]);

  /**
   * A target is a pending row with its numbers already filled in.
   *
   * The server says what is still prescribed; the draft says what the user
   * changed about it. Neither is complete on its own, and neither is stored in
   * `sets` until the tick — ADR 0010.
   */
  const targetRows = useMemo(() => {
    const byExercise = new Map<string, DraftRow[]>();
    for (const target of targets) {
      if (draft.dismissed.includes(target.key)) continue;
      const rows = byExercise.get(target.exerciseId) ?? [];
      rows.push({
        key: target.key,
        weightKg: target.weightKg === null ? '' : String(target.weightKg),
        reps: String(target.reps),
        rpe: target.rpe === null ? '' : String(target.rpe),
        restSeconds: String(target.restSeconds ?? DEFAULT_REST_SECONDS),
        // A template prescribes working sets; warm-ups are the lifter's own.
        isWarmup: false,
        ...draft.overrides[target.key],
      });
      byExercise.set(target.exerciseId, rows);
    }
    return byExercise;
  }, [targets, draft.dismissed, draft.overrides]);

  const rowsFor = (exerciseId: string): DraftRow[] => [
    ...(targetRows.get(exerciseId) ?? []),
    ...(draft.rows[exerciseId] ?? []),
  ];

  /**
   * Session order, then anything added since — `logged` already arrives in the
   * order the sets were performed, and a Map keeps that.
   */
  const groups = useMemo<LiftGroup[]>(() => {
    const byExercise = new Map<string, LiftGroup>();
    for (const set of logged) {
      const group = byExercise.get(set.exerciseId) ?? {
        id: set.exerciseId,
        name: set.exerciseName,
        sets: [],
      };
      group.sets.push(set);
      byExercise.set(set.exerciseId, group);
    }
    // The prescription comes before anything the user added by hand: it is the
    // session they chose to run.
    for (const target of targets) {
      if (!byExercise.has(target.exerciseId)) {
        byExercise.set(target.exerciseId, {
          id: target.exerciseId,
          name: candidates.find((c) => c.id === target.exerciseId)?.name ?? 'Unknown exercise',
          sets: [],
        });
      }
    }
    for (const added of draft.added) {
      if (!byExercise.has(added.id)) {
        byExercise.set(added.id, { id: added.id, name: added.name, sets: [] });
      }
    }
    return [...byExercise.values()];
  }, [logged, draft.added, targets, candidates]);

  const results = useMemo(
    () => candidates.filter((c) => matches(c, query)).slice(0, MAX_RESULTS),
    [candidates, query]
  );

  const patchRows = (exerciseId: string, next: (rows: DraftRow[]) => DraftRow[]) => {
    setDraft((current) => ({
      ...current,
      rows: { ...current.rows, [exerciseId]: next(current.rows[exerciseId] ?? []) },
    }));
  };

  const addRow = (exerciseId: string, values: Partial<DraftRow> = {}) => {
    // Rest length carries over from the row before it: someone resting three
    // minutes on squats is resting three minutes on the next squat set too.
    patchRows(exerciseId, (rows) => {
      const last = rows[rows.length - 1];
      return [
        ...rows,
        newRow({ restSeconds: last?.restSeconds ?? String(DEFAULT_REST_SECONDS), ...values }),
      ];
    });
  };

  const addExercise = (candidate: Candidate) => {
    setQuery('');
    setPicking(false);
    setDraft((current) => {
      const existing = current.rows[candidate.id] ?? [];
      return {
        ...current,
        added: current.added.some((a) => a.id === candidate.id)
          ? current.added
          : [...current.added, { id: candidate.id, name: candidate.name }],
        // An exercise with no row to fill in is a heading with nothing under it.
        rows: { ...current.rows, [candidate.id]: existing.length > 0 ? existing : [newRow()] },
      };
    });
  };

  const removeExercise = (exerciseId: string) => {
    setDraft((current) => {
      const rows = { ...current.rows };
      delete rows[exerciseId];
      return { ...current, added: current.added.filter((a) => a.id !== exerciseId), rows };
    });
  };

  const updateRow = (exerciseId: string, key: string, patch: Partial<DraftRow>) => {
    setError(null);
    if (isTargetKey(key)) {
      // The target itself belongs to the server. Only the divergence is stored.
      setDraft((current) => ({
        ...current,
        overrides: { ...current.overrides, [key]: { ...current.overrides[key], ...patch } },
      }));
      return;
    }
    patchRows(exerciseId, (rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (exerciseId: string, key: string) => {
    if (isTargetKey(key)) {
      // Skipping a prescribed set is a decision, not a deletion: the template
      // is unchanged and every other session started from it still asks for it.
      setDraft((current) => ({
        ...current,
        dismissed: current.dismissed.includes(key)
          ? current.dismissed
          : [...current.dismissed, key],
      }));
      return;
    }
    patchRows(exerciseId, (rows) => rows.filter((r) => r.key !== key));
  };

  /** A logged target stops being pending; its override has nothing left to edit. */
  const forgetOverride = (key: string) => {
    setDraft((current) => {
      if (current.overrides[key] === undefined) return current;
      const overrides = { ...current.overrides };
      delete overrides[key];
      return { ...current, overrides };
    });
  };

  /**
   * The tick, and the only write on this screen.
   *
   * An empty box means "what the placeholder says" — the placeholder is last
   * session's number and it is the value the user is looking at when they tap.
   * Requiring them to retype it to confirm it would make the common case the
   * slow one.
   */
  const commitRow = (group: LiftGroup, row: DraftRow, fallback: PreviousSet | undefined) => {
    const weightKg =
      row.weightKg.trim() ||
      (fallback?.weightKg === null || fallback === undefined ? '' : String(fallback.weightKg));
    const reps =
      row.reps.trim() ||
      (fallback?.reps === null || fallback === undefined ? '' : String(fallback.reps));

    if (reps === '') {
      setError(`${group.name}: fill in reps first.`);
      return;
    }

    const requested = Number(row.restSeconds);
    const restSeconds = Number.isFinite(requested) && requested > 0 ? requested : 0;

    const form = new FormData();
    form.set('workoutId', workoutId);
    form.set('exerciseId', group.id);
    form.set('weightKg', weightKg);
    form.set('reps', reps);
    form.set('rpe', row.rpe.trim());
    form.set('restSeconds', String(restSeconds));
    if (row.isWarmup) form.set('isWarmup', 'on');

    setError(null);
    setSaving(row.key);

    startTransition(async () => {
      try {
        await logSet(form);
        // The row is dropped only once the server has it. Until then it keeps
        // its values, so a failure costs nothing typed. A target drops itself:
        // `pendingTargets` stops returning it as soon as the set exists.
        if (isTargetKey(row.key)) forgetOverride(row.key);
        else removeRow(group.id, row.key);
        if (restSeconds > 0) {
          // Rest starts on its own — reaching for a second button is the step
          // people skip when they are out of breath.
          setRestTrigger({ seconds: restSeconds, nonce: Date.now() });
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not log that set.');
      } finally {
        setSaving(null);
      }
    });
  };

  const removeSet = (set: LoggedSet, keepValues: boolean) => {
    const form = new FormData();
    form.set('setId', set.id);
    form.set('workoutId', workoutId);

    setError(null);
    startTransition(async () => {
      try {
        await deleteSet(form);
        if (keepValues) {
          addRow(set.exerciseId, {
            weightKg: set.weightKg === null ? '' : String(set.weightKg),
            reps: set.reps === null ? '' : String(set.reps),
            rpe: set.rpe === null ? '' : String(set.rpe),
            restSeconds: String(set.restSeconds ?? DEFAULT_REST_SECONDS),
            isWarmup: set.isWarmup,
          });
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not remove that set.');
      }
    });
  };

  return (
    <>
      <div className="lifts">
        {groups.map((group) => (
          <LiftBlock
            key={group.id}
            group={group}
            previous={previous[group.id] ?? { warmup: [], working: [] }}
            drafts={rowsFor(group.id)}
            editable={editable}
            saving={saving}
            onAddRow={addRow}
            onUpdateRow={updateRow}
            onRemoveRow={removeRow}
            onCommitRow={commitRow}
            onUncheck={(set) => removeSet(set, true)}
            onDeleteSet={(set) => removeSet(set, false)}
            onRemoveExercise={removeExercise}
          />
        ))}

        {groups.length === 0 ? (
          <p className="muted empty">
            No exercises yet. {editable ? 'Add the first one below.' : 'Nothing was logged.'}
          </p>
        ) : null}
      </div>

      {error ? <p className="error small">{error}</p> : null}

      {editable ? (
        <>
          <div className="combo add-exercise">
            {picking ? (
              <>
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  placeholder="Search — try “squat”, “db press”, “lats”"
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={() => {
                    // Let a click on a result land before the list closes.
                    window.setTimeout(() => setPicking(false), 150);
                  }}
                  aria-expanded={picking}
                  aria-controls="exercise-results"
                />
                <ul className="combo-list" id="exercise-results" role="listbox">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => addExercise(c)}>
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
              </>
            ) : (
              <button
                type="button"
                className="add-exercise-btn"
                onClick={() => {
                  setPicking(true);
                  requestAnimationFrame(() => searchRef.current?.focus());
                }}
              >
                + Add exercise
              </button>
            )}
          </div>

          {candidates.length === 0 ? (
            <p className="error small">
              No equipment recorded, so there is nothing to choose from. Tell it what you can train
              with under <a href="/settings">Settings</a>.
            </p>
          ) : null}

          <QuickLog workoutId={workoutId} />
          <RestTimer trigger={restTrigger} />
        </>
      ) : null}
    </>
  );
}
