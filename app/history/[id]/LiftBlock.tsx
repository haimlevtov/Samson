'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { LoggedSet, PreviousSet, PreviousSets } from '@/src/db/training';
import type { DraftRow } from './session-draft';
import { Icon } from '@/src/ui/icons';

export interface LiftGroup {
  id: string;
  name: string;
  /** Performed sets, in the order they were logged. */
  sets: LoggedSet[];
}

/**
 * One exercise's set grid — ADR 0011.
 *
 * A line is either performed (a `sets` row, green, ticked) or pending (editable,
 * not in the database). They share the grid so that what you are about to do and
 * what you did look alike.
 */
type Line =
  | { kind: 'done'; prev: PreviousSet | undefined; label: string; set: LoggedSet; last: boolean }
  | { kind: 'draft'; prev: PreviousSet | undefined; label: string; row: DraftRow };

function restLabel(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The number the next set is chosen from — interface spec §2, rank 2.
 * An em dash when there is no earlier session: a blank reads as a broken
 * lookup, and a zero would be a claim.
 */
function previousLabel(previous: PreviousSet | undefined): string {
  if (previous === undefined || previous.reps === null) return '—';
  const load = previous.weightKg === null ? 'BW' : `${previous.weightKg} kg`;
  return `${load} × ${previous.reps}`;
}

/** Empty string rather than "null" in the box when there is nothing to suggest. */
function placeholderFor(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export function LiftBlock({
  group,
  previous,
  drafts,
  editable,
  saving,
  onAddRow,
  onUpdateRow,
  onRemoveRow,
  onCommitRow,
  onUncheck,
  onDeleteSet,
  onRemoveExercise,
}: {
  group: LiftGroup;
  previous: PreviousSets;
  drafts: DraftRow[];
  editable: boolean;
  /** Key of the row being written, so only that tick shows as busy. */
  saving: string | null;
  onAddRow: (exerciseId: string) => void;
  onUpdateRow: (exerciseId: string, key: string, patch: Partial<DraftRow>) => void;
  onRemoveRow: (exerciseId: string, key: string) => void;
  onCommitRow: (group: LiftGroup, row: DraftRow, previous: PreviousSet | undefined) => void;
  onUncheck: (set: LoggedSet) => void;
  onDeleteSet: (set: LoggedSet) => void;
  onRemoveExercise: (exerciseId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((current) => (current === id ? null : id));

  // Warm-ups are marked, not numbered — they are not set 1. The counters run
  // across performed and pending rows together, so nothing renumbers when a
  // pending row becomes a performed one, and each row reads last session's set
  // of its own kind.
  const lines: Line[] = [];
  let working = 0;
  let warming = 0;
  const takePrevious = (isWarmup: boolean): PreviousSet | undefined =>
    isWarmup ? previous.warmup[warming++] : previous.working[working++];

  group.sets.forEach((set, i) => {
    const prev = takePrevious(set.isWarmup);
    lines.push({
      kind: 'done',
      prev,
      label: set.isWarmup ? 'W' : String(working),
      set,
      last: i === group.sets.length - 1,
    });
  });
  for (const row of drafts) {
    const prev = takePrevious(row.isWarmup);
    lines.push({ kind: 'draft', prev, label: row.isWarmup ? 'W' : String(working), row });
  }

  // The divider says how long the gap between two rows was. After the last one
  // there is no gap — the session moved on to something else.
  const lastIndex = lines.length - 1;

  return (
    <section className="lift">
      <header className="lift-head">
        <h3 className="lift-name">{group.name}</h3>
        {/* The chart this icon has promised since ADR 0011. It pointed at
            /progress, then /hub, then a Hub with no badges on it — ADR 0014. */}
        <Link
          className="icon-btn"
          href={`/history/exercise/${group.id}`}
          aria-label={`${group.name} progression`}
        >
          <Icon name="chart-line" size={17} />
        </Link>
        {editable && group.sets.length === 0 ? (
          <button
            type="button"
            className="icon-btn"
            aria-label={`Remove ${group.name} from this session`}
            onClick={() => onRemoveExercise(group.id)}
          >
            ×
          </button>
        ) : null}
      </header>

      <div className="set-grid">
        <div className="set-head" aria-hidden="true">
          <span>Set</span>
          <span>Previous</span>
          <span>Kg</span>
          <span>Reps</span>
          <span />
        </div>

        {lines.map((line, index) => {
          const prev = line.prev;
          const id = line.kind === 'done' ? line.set.id : line.row.key;
          const expanded = open === id;

          if (line.kind === 'done') {
            const { set, last } = line;
            const rest = restLabel(set.restSeconds);
            const divider = index === lastIndex ? null : rest;

            return (
              <div key={id} className="set-line">
                <div className="set-row done">
                  <button
                    type="button"
                    className={`set-no ${set.isWarmup ? 'warm' : ''}`}
                    aria-expanded={expanded}
                    aria-label={`Set ${line.label} details`}
                    onClick={() => toggle(id)}
                  >
                    {line.label}
                  </button>
                  <span className="set-prev">{previousLabel(prev)}</span>
                  <span className="set-val">{set.weightKg === null ? '—' : set.weightKg}</span>
                  <span className="set-val">{set.reps ?? '—'}</span>

                  {/* Only the last set un-ticks. Un-ticking from the middle
                      would renumber every row below it while the user watched;
                      those are deleted from the row's own detail line. */}
                  {editable && last ? (
                    <button
                      type="button"
                      className="tick on"
                      aria-label={`Undo set ${line.label}`}
                      onClick={() => onUncheck(set)}
                    >
                      ✓
                    </button>
                  ) : (
                    <span className="tick on static" role="img" aria-label="Logged">
                      ✓
                    </span>
                  )}
                </div>

                {expanded ? (
                  <div className="set-more">
                    <span className="small muted">RPE {set.rpe ?? '—'}</span>
                    <span className="small muted">rest {rest ?? '—'}</span>
                    {editable ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setOpen(null);
                          onDeleteSet(set);
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {divider === null ? null : <div className="rest-note">{divider}</div>}
              </div>
            );
          }

          const { row } = line;
          const busy = saving === row.key;

          return (
            <div key={id} className="set-line">
              <div className="set-row">
                <button
                  type="button"
                  className={`set-no ${row.isWarmup ? 'warm' : ''}`}
                  aria-expanded={expanded}
                  aria-label={`Set ${line.label} options`}
                  onClick={() => toggle(id)}
                >
                  {line.label}
                </button>

                {/* Tapping last time's numbers copies them in. The commonest
                    entry is "same again", and it should not need a keyboard. */}
                {prev === undefined ? (
                  <span className="set-prev">—</span>
                ) : (
                  <button
                    type="button"
                    className="set-prev copy"
                    onClick={() =>
                      onUpdateRow(group.id, row.key, {
                        weightKg: placeholderFor(prev.weightKg),
                        reps: placeholderFor(prev.reps),
                      })
                    }
                  >
                    {previousLabel(prev)}
                  </button>
                )}

                <input
                  className="set-in"
                  type="number"
                  step="0.5"
                  min="0"
                  inputMode="decimal"
                  aria-label={`Weight in kilograms, set ${line.label}`}
                  placeholder={placeholderFor(prev?.weightKg)}
                  value={row.weightKg}
                  disabled={busy}
                  onChange={(e) => onUpdateRow(group.id, row.key, { weightKg: e.target.value })}
                />
                <input
                  className="set-in"
                  type="number"
                  step="1"
                  min="0"
                  inputMode="numeric"
                  aria-label={`Reps, set ${line.label}`}
                  placeholder={placeholderFor(prev?.reps)}
                  value={row.reps}
                  disabled={busy}
                  onChange={(e) => onUpdateRow(group.id, row.key, { reps: e.target.value })}
                />
                <button
                  type="button"
                  className="tick"
                  disabled={busy}
                  aria-label={`Log set ${line.label}`}
                  onClick={() => onCommitRow(group, row, prev)}
                >
                  {busy ? '·' : '✓'}
                </button>
              </div>

              {expanded ? (
                <div className="set-more">
                  <label className="more-field">
                    <span className="label">RPE</span>
                    <input
                      type="number"
                      step="0.5"
                      min="1"
                      max="10"
                      inputMode="decimal"
                      value={row.rpe}
                      onChange={(e) => onUpdateRow(group.id, row.key, { rpe: e.target.value })}
                    />
                  </label>
                  <label className="more-field">
                    <span className="label">Rest s</span>
                    <input
                      type="number"
                      step="15"
                      min="0"
                      inputMode="numeric"
                      value={row.restSeconds}
                      onChange={(e) =>
                        onUpdateRow(group.id, row.key, { restSeconds: e.target.value })
                      }
                    />
                  </label>
                  <label className="more-check">
                    <input
                      type="checkbox"
                      checked={row.isWarmup}
                      onChange={(e) =>
                        onUpdateRow(group.id, row.key, { isWarmup: e.target.checked })
                      }
                    />
                    <span>Warm-up</span>
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onRemoveRow(group.id, row.key)}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {editable ? (
        <button type="button" className="add-set" onClick={() => onAddRow(group.id)}>
          + Add set
        </button>
      ) : null}
    </section>
  );
}
