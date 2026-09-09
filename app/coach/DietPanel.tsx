'use client';

import { useActionState } from 'react';
import { MAX_DIET_QUESTION_CHARS } from '@/src/llm/config';
import { DIET_GOALS } from '@/src/diet/energy';
import { askDietAdvisor } from './actions';
import { EMPTY_DIET, type DietState } from './diet-state';

/**
 * The diet advisor. Design and threat model: ADR 0024. Contract:
 * docs/specs/diet.md.
 *
 * WHY a disclosure on /coach rather than a route or a sixth tab:
 * docs/specs/mobile-interface.md draws the line — "a disclosure reveals more of
 * what the page is already about; a different subject gets a route instead".
 * A calorie target for the training you are being coached on is the same
 * subject as the plan above it, and it is one block rather than a page.
 *
 * Everything that constrains this is on the server. This component posts a goal
 * and a question and renders what comes back; nothing here is a control, and
 * every figure it shows arrives from `computeEnergy` rather than from a model.
 */
const GOAL_BLURB: Record<string, string> = {
  cut: 'Lose weight',
  maintain: 'Stay where I am',
  gain: 'Gain weight',
};

/** What each refusal says, in the app's words rather than a model's. */
function Refusal({ state }: { state: DietState }) {
  const result = state.result;
  if (result === null || result.kind === 'ok') return null;

  if (result.kind === 'missing-biometric') {
    const FIELD: Record<string, string> = {
      bodyweightKg: 'your bodyweight',
      heightCm: 'your height',
      birthDate: 'your date of birth',
      sex: 'the sex field',
    };
    return (
      <p className="muted">
        This needs {FIELD[result.missing] ?? 'a missing detail'} first. Add it under{' '}
        <a href="/settings">Settings</a> and ask again — it is only used here.
      </p>
    );
  }

  if (result.kind === 'under-18') {
    /*
     * ADR 0024 §6. A code gate, not a prompt: no model is called at all on this
     * path, so there is nothing to talk round.
     */
    return (
      <p className="muted">
        This app does not set calorie targets for under-18s. Someone still growing needs advice from
        a doctor or a registered dietitian, not from a formula.
      </p>
    );
  }

  return (
    <p className="muted">
      Those numbers do not add up to a person the equation can read — check your height and
      bodyweight under <a href="/settings">Settings</a>.
    </p>
  );
}

export function DietPanel() {
  const [state, formAction, pending] = useActionState<DietState, FormData>(
    askDietAdvisor,
    EMPTY_DIET
  );

  const target = state.result?.kind === 'ok' ? state.result : null;

  return (
    /*
     * A <details> rather than client state: no JavaScript needed to open it, it
     * is keyboard and screen-reader navigable for free, and with CSS off it
     * degrades to an open section rather than a hidden one — the same reasoning
     * as the plan disclosure above it.
     */
    <details className="plan-disclosure card">
      <summary>
        <span className="label">Daily calories</span>
        <span className="muted small">
          {target ? `${target.targetKcal} kcal` : 'Worked out from your training'}
        </span>
      </summary>

      <div className="plan-body">
        <form action={formAction} className="settings-form">
          <label>
            <span className="label">What are you after?</span>
            {/*
             * Not persisted — ADR 0024 §1. A stored goal goes stale silently,
             * and the target is computed fresh from it every time.
             */}
            <select name="goal" defaultValue={state.goal}>
              {DIET_GOALS.map((goal) => (
                <option key={goal} value={goal}>
                  {GOAL_BLURB[goal]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="label">Anything to ask about it? (optional)</span>
            <input
              name="question"
              type="text"
              maxLength={MAX_DIET_QUESTION_CHARS}
              placeholder="Why is it this number?"
              autoComplete="off"
            />
          </label>

          <div className="settings-submit">
            <button type="submit" disabled={pending}>
              {pending ? 'Working it out…' : 'Work out my target'}
            </button>
          </div>
        </form>

        {state.result === null ? (
          <p className="muted small">
            Nothing is calculated until you ask. The figure comes from your height, weight, age and
            how often you have actually trained — not from the coach, which never sees any of them.
          </p>
        ) : null}

        <Refusal state={state} />

        {target ? (
          <>
            {/*
             * INVARIANT: every figure here is rendered from the engine's own
             *            result — CLAUDE.md #6. The model is not given them and
             *            may not write a digit, so nothing below can have come
             *            from it.
             */}
            <table className="table-cards">
              <tbody>
                <tr>
                  <td data-label="Daily target">
                    <strong>{target.targetKcal} kcal</strong>
                  </td>
                  <td data-label="Protein">{target.proteinG} g</td>
                </tr>
                <tr>
                  <td data-label="Resting burn">{target.bmrKcal} kcal</td>
                  <td data-label="With training">{target.tdeeKcal} kcal</td>
                </tr>
              </tbody>
            </table>

            {target.floorReached ? (
              <p className="muted small">
                That is the floor — {target.floorKcal} kcal — rather than the goal. The app will not
                prescribe below your resting burn however the goal is set.
              </p>
            ) : null}

            {state.summary ? (
              <div className="card">
                <p>{state.summary}</p>
                <p className="muted small">{state.caveat}</p>
              </div>
            ) : null}

            <p className="muted small">
              A general estimate from a standard equation, not medical advice. Activity is read from
              your logged sessions over the last four weeks, which is training rather than
              everything you do in a day.
            </p>
          </>
        ) : null}

        {state.error ? <p className="error small">{state.error}</p> : null}
      </div>
    </details>
  );
}
