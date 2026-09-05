'use client';

import { useActionState, useState } from 'react';
import { createTemplateFromPlan, createTemplateFromSession } from './actions';
import { EMPTY_TEMPLATE_FORM, type TemplateFormState } from './form-state';

export interface SessionOption {
  id: string;
  label: string;
}

export interface PlanSessionOption {
  weekNumber: number;
  dayIndex: number;
  label: string;
}

/**
 * Save a session that already happened.
 *
 * The prescription is derived on the server from the logged sets — the browser
 * sends a workout id and a name, never a set. ADR 0010: what was performed and
 * what is being prescribed stay separate facts even when one is copied from the
 * other.
 */
export function SessionImportForm({ sessions }: { sessions: SessionOption[] }) {
  const [state, action, pending] = useActionState<TemplateFormState, FormData>(
    createTemplateFromSession,
    EMPTY_TEMPLATE_FORM
  );

  if (sessions.length === 0) {
    return (
      <p className="muted small">
        No finished session has working sets in it yet. Log one and it can become a template.
      </p>
    );
  }

  return (
    <form action={action}>
      <label>
        <span className="label">Session</span>
        <select name="workoutId" defaultValue={sessions[0]?.id}>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="label">Name (optional)</span>
        <input name="name" maxLength={80} placeholder="Leave blank to use the date" />
      </label>

      {state.error ? <p className="error small">{state.error}</p> : null}

      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save as template'}
      </button>
    </form>
  );
}

/**
 * Import one session of the coach's accepted plan.
 *
 * INVARIANT: the numbers are read server-side from the accepted `plan_runs`
 *            block — CLAUDE.md #1. This form sends a week and a day, and could
 *            not send a prescription if it wanted to.
 */
export function PlanImportForm({ sessions }: { sessions: PlanSessionOption[] }) {
  const [state, action, pending] = useActionState<TemplateFormState, FormData>(
    createTemplateFromPlan,
    EMPTY_TEMPLATE_FORM
  );
  const [choice, setChoice] = useState(
    sessions[0] ? `${sessions[0].weekNumber}|${sessions[0].dayIndex}` : ''
  );

  if (sessions.length === 0) {
    return (
      <p className="muted small">
        No accepted plan yet. One appears once the planner has produced a block that passes both the
        deterministic rules and the safety critic.
      </p>
    );
  }

  const [weekNumber, dayIndex] = choice.split('|');

  return (
    <form action={action}>
      <input type="hidden" name="weekNumber" value={weekNumber ?? ''} />
      <input type="hidden" name="dayIndex" value={dayIndex ?? ''} />

      <label>
        <span className="label">Session from your plan</span>
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          {sessions.map((s) => (
            <option key={`${s.weekNumber}|${s.dayIndex}`} value={`${s.weekNumber}|${s.dayIndex}`}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {state.error ? <p className="error small">{state.error}</p> : null}

      <button type="submit" disabled={pending}>
        {pending ? 'Importing…' : 'Import from plan'}
      </button>
    </form>
  );
}
