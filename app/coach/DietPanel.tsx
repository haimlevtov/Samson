'use client';

import { useActionState } from 'react';
import { MAX_DIET_QUESTION_CHARS } from '@/src/llm/config';
import { askDietAdvisor } from './actions';
import { EMPTY_DIET, type DietState } from './diet-state';

/** What each goal means, in the user's words rather than the schema's. */
const GOAL_BLURB: Record<string, string> = {
  cut: 'Lose weight',
  maintain: 'Stay where I am',
  gain: 'Gain weight',
};

/**
 * Maintain first, deliberately.
 *
 * A browser given a `defaultValue` matching no option selects the FIRST one, so
 * the order decides what a malformed state falls back to. `DIET_GOALS` is
 * `['cut', 'maintain', 'gain']` for the engine's own reasons; here the fail case
 * has to be the same one the engine picks, and that is maintain.
 */
const GOAL_ORDER = ['maintain', 'cut', 'gain'] as const;

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

  /*
   * FOUND IN REVIEW: one sentence used to cover all five `implausible-input`
   * reasons, and it pointed at height and bodyweight — the wrong field for a bad
   * birth date and for a sex outside the three. `docs/specs/diet.md` §3 lists
   * the reasons distinctly, so the surface does too.
   */
  const WHERE_TO_LOOK: Record<string, string> = {
    'unreal-date': 'Check your date of birth',
    'out-of-range': 'Check your height, bodyweight and sex',
    'non-finite': 'Check your height and bodyweight',
    'no-resting-rate': 'Check your height, bodyweight and date of birth',
    ceiling: 'Check your height and bodyweight',
  };

  return (
    <p className="muted">
      Those figures do not describe a person the equation can read.{' '}
      {WHERE_TO_LOOK[result.reason] ?? 'Check your details'} under <a href="/settings">Settings</a>.
    </p>
  );
}

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
             * Not persisted — docs/plans/phase-6.md, "what is deliberately
             * out", and decision 1 in the same file. A stored goal goes stale silently,
             * and the target is computed fresh from it every time.
             */}
            {/*
             * FOUND IN REVIEW: this echoed the RAW submitted goal, and a browser
             * given a value matching no option selects the FIRST one. With
             * `DIET_GOALS` ordered cut-first that made the UI's fail case a
             * deficit, while the code's is maintain (`normaliseGoal`, and
             * ADR 0024 §3 makes a point of it). The two defaults now agree:
             * maintain is first in the list, and what is echoed back has been
             * through the engine.
             */}
            <select name="goal" defaultValue={target?.goal ?? 'maintain'}>
              {GOAL_ORDER.map((goal) => (
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
            {/*
             * FOUND IN REVIEW: this was a `.table-cards`, and it should never
             * have been. That class is a responsive TABLE — below 760px it
             * stacks and prints `data-label` before each cell, and at 760px
             * `app/globals.css` restores `thead { display: table-header-group }`
             * and sets `td::before { content: none }`. With no `<thead>` — and
             * with four cells that mean four different things rather than two
             * columns of one — every label vanished above the breakpoint and
             * left four bare figures. This is a key/value list, so it is one.
             */}
            <dl className="diet-figures">
              <div className="row">
                <dt className="label">Daily target</dt>
                <dd>
                  <strong>{target.targetKcal} kcal</strong>
                </dd>
              </div>
              <div className="row">
                <dt className="label">Protein</dt>
                <dd>{target.proteinG} g</dd>
              </div>
              <div className="row">
                <dt className="label">Resting burn</dt>
                <dd>{target.bmrKcal} kcal</dd>
              </div>
              <div className="row">
                <dt className="label">With your training</dt>
                <dd>{target.tdeeKcal} kcal</dd>
              </div>
            </dl>

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
