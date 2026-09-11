'use client';

import { useActionState, useEffect, useRef } from 'react';
import { MAX_CHAT_MESSAGE_CHARS } from '@/src/llm/config';
import { NO_SUPPLEMENT_MATCH_REPLY } from '@/src/chat/reply';
import { EvidenceBody } from '@/src/ui/EvidenceCard';
import { askTheCoach } from './actions';
import { EMPTY_COACH, type CoachState } from './coach-state';

/** What each goal means, in the user's words rather than the schema's. */
const GOAL_BLURB: Record<string, string> = {
  cut: 'Lose weight',
  maintain: 'Maintenance',
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
function Refusal({ state }: { state: CoachState }) {
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
 * The goal, the figures, and one question box — rework PR 8a, ADR 0015 §6.
 *
 * Replaces `ChatPanel`, `DietPanel` and `SupplementPanel`. Three fields asked
 * the user to classify their own question before typing it, and that
 * classification was ours to make: somebody wondering whether to eat more on a
 * heavy week does not know, and should not have to know, that the app has a diet
 * stage and a chat stage.
 *
 * WHY the goal, the figures and the box are ONE component: the box needs the
 * selected goal to answer a diet question, and lifting that into a shared parent
 * would be the same state in a less obvious place. One form carries all of it,
 * which is also why a goal change costs no model call — the action recomputes
 * and returns before it would reach one.
 *
 * INVARIANT: every figure below is rendered from `computeEnergy`'s own result —
 *            CLAUDE.md #6. The model is not given them and may not write a digit
 *            on the diet route, so nothing here can have come from it.
 *
 * INVARIANT: the supplement answer is the ROW — ADR 0023. `EvidenceBody` is the
 *            same component `/evidence` renders, so the grade, claim, dose,
 *            caution and citation are the table's own words. The model's prose
 *            is not returned on that route at all.
 *
 * WHY the transcript lives in this component's action state rather than a table:
 * the stage has no database write path, and that absence is what makes "a
 * jailbroken box cannot persist anything" a guarantee instead of a hope. The
 * cost is that the conversation ends with the page, which is stated to the user
 * rather than left to be discovered.
 *
 * Everything that constrains the coach is on the server. Nothing here is a
 * control.
 */
export function CoachBox() {
  const [state, formAction, pending] = useActionState<CoachState, FormData>(
    askTheCoach,
    EMPTY_COACH
  );

  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const target = state.result?.kind === 'ok' ? state.result : null;

  /*
   * Clear the message box once a turn lands, not on submit.
   *
   * WHY: clearing optimistically loses what the user wrote whenever the call
   * fails, and the failure case here is the common one — no API key, or the
   * weekly budget spent. The action returns the user's own turn in `turns`
   * either way, so by the time this runs the message is on screen.
   *
   * WHY only the textarea and not `form.reset()`: the goal `<select>` is in the
   * same form now, and resetting it would snap the user's choice back to
   * maintain on every answer.
   */
  useEffect(() => {
    const field = formRef.current?.elements.namedItem('message');
    if (field instanceof HTMLTextAreaElement) field.value = '';
  }, [state.turns]);

  /*
   * Newest turn into view, but never on mount.
   *
   * WHY the length guard: this effect runs once when the component mounts, and
   * on a 375px screen with a plan present that scrolled /coach straight past
   * its own header to the bottom of the page the moment it opened. There is no
   * newest turn to reveal when there are no turns.
   *
   * `block: 'nearest'` so it does not jump when the panel is already visible.
   */
  useEffect(() => {
    if (state.turns.length === 0) return;
    endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.turns]);

  return (
    <form action={formAction} ref={formRef}>
      <h2 className="section">Diet</h2>

      {/*
       * A <details> rather than client state: no JavaScript needed to open it,
       * it is keyboard and screen-reader navigable for free, and with CSS off it
       * degrades to an open section rather than a hidden one — the same
       * reasoning as the plan disclosure above it.
       */}
      <details className="plan-disclosure card">
        <summary>
          <span className="label">Daily calories</span>
          <span className="muted small">
            {target ? `${target.targetKcal} kcal` : 'Worked out from your training'}
          </span>
        </summary>

        <div className="plan-body">
          <label>
            <span className="label">What are you after?</span>
            {/*
             * Not persisted — docs/plans/phase-6.md, "what is deliberately out".
             * A stored goal goes stale silently, and the target is computed
             * fresh from it every time.
             *
             * FOUND IN REVIEW: this echoed the RAW submitted goal, and a browser
             * given a value matching no option selects the FIRST one. With
             * `DIET_GOALS` ordered cut-first that made the UI's fail case a
             * deficit, while the code's is maintain (`normaliseGoal`, and ADR
             * 0024 §3 makes a point of it). The two defaults now agree.
             */}
            <select name="goal" defaultValue={state.goal} disabled={pending}>
              {GOAL_ORDER.map((goal) => (
                <option key={goal} value={goal}>
                  {GOAL_BLURB[goal]}
                </option>
              ))}
            </select>
          </label>

          <div className="settings-submit">
            <button type="submit" className="secondary" disabled={pending}>
              {pending ? 'Working it out…' : 'Work out my target'}
            </button>
          </div>

          {state.result === null ? (
            <p className="muted small">
              Nothing is calculated until you ask. The figure comes from your height, weight, age
              and how often you have actually trained — not from the coach, which never sees any of
              them.
            </p>
          ) : null}

          <Refusal state={state} />

          {target ? (
            <>
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
                  That is the floor — {target.floorKcal} kcal — rather than the goal. The app will
                  not prescribe below your resting burn however the goal is set.
                </p>
              ) : null}

              <p className="muted small">
                A general estimate from a standard equation, not medical advice. Activity is read
                from your logged sessions over the last four weeks, which is training rather than
                everything you do in a day.
              </p>
            </>
          ) : null}
        </div>
      </details>

      <div className="card chat">
        {state.turns.length === 0 ? (
          /*
           * The boundary is stated before somebody hits it. A refusal that
           * arrives with no warning reads as the app being broken; the same
           * refusal after this line reads as the thing it is.
           */
          <p className="muted chat-empty">
            Ask about your training, what to eat around it, or what the evidence says about a
            supplement — a lift that has stalled, whether to deload, why the figure above is what it
            is. It can only see the figures on your Profile and History tabs. The conversation is
            not kept: it ends when you leave this page.
          </p>
        ) : (
          <ol className="chat-log">
            {state.turns.map((turn, i) => (
              <li
                // Index is part of the key on purpose: the same question asked
                // twice is two turns, and the text alone would collide.
                key={`${i}-${turn.role}`}
                className={`chat-turn chat-${turn.role}`}
              >
                <span className="chat-who">{turn.role === 'user' ? 'You' : 'Coach'}</span>
                <p>{turn.text}</p>

                {/*
                 * The row belongs to the NEWEST turn, which is the only one the
                 * state carries — a transcript of rows would mean holding every
                 * row every answer ever named, and re-sending them on each turn.
                 *
                 * The SAME component `/evidence` renders — src/ui/EvidenceCard.tsx.
                 * FOUND IN REVIEW of the panel this replaces: it was a copy, and
                 * it had already dropped the grade LABEL on its first outing,
                 * leaving a bare letter. `app/globals.css` states the invariant
                 * on the `.evidence-grade` rule itself — state is never carried
                 * by colour alone — and only A and D are tinted, so a B or C row
                 * rendered as a lone grey character.
                 */}
                {state.row !== null && i === state.turns.length - 1 ? (
                  <div className="card evidence-row">
                    <EvidenceBody row={state.row} />
                  </div>
                ) : null}

                {turn.text === NO_SUPPLEMENT_MATCH_REPLY ? (
                  <p className="muted small">
                    <a href="/evidence">the whole table is here</a>.
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}

        <div ref={endRef} />

        {state.error ? <p className="error small">{state.error}</p> : null}

        <div className="chat-form">
          <label className="sr-only" htmlFor="chat-message">
            Ask your coach
          </label>
          <textarea
            id="chat-message"
            name="message"
            rows={2}
            // The server rejects anything longer and says so; this stops most
            // people reaching that error at all.
            maxLength={MAX_CHAT_MESSAGE_CHARS}
            placeholder="How is my squat going?"
            disabled={pending}
          />
          <div className="row chat-actions">
            <button type="submit" disabled={pending}>
              {pending ? 'Asking…' : 'Send'}
            </button>
            {state.turns.length > 0 ? (
              <button
                type="submit"
                name="intent"
                value="clear"
                className="secondary"
                disabled={pending}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </form>
  );
}
