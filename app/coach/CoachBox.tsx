'use client';

import { useActionState, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MAX_CHAT_MESSAGE_CHARS } from '@/src/llm/config';
import { DIET_GOALS, type DietGoal } from '@/src/diet/energy';
import { EvidenceBody } from '@/src/ui/EvidenceCard';
import { askTheCoach } from './actions';
import { EMPTY_COACH, type CoachState } from './coach-state';
import { BLOCKED_TEXT, SILENT_TEXT, useReplyVoice } from '@/src/ui/reply-voice';
import { SpeakSwitch } from '@/src/ui/SpeakSwitch';

/**
 * What each goal means, in the user's words rather than the schema's.
 *
 * `Record<DietGoal, string>`, so a goal added to `DIET_GOALS` fails to compile
 * here rather than rendering an empty option. It was `Record<string, string>`,
 * which made this a second, unguarded copy of the goal set.
 */
const GOAL_BLURB: Record<DietGoal, string> = {
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
 *
 * Derived from `DIET_GOALS` rather than listed again: reordering is the point,
 * but MEMBERSHIP is not this file's to decide, and a hand-written list would
 * silently drop a fourth goal instead of showing it.
 */
const GOAL_ORDER: readonly DietGoal[] = [
  'maintain',
  ...DIET_GOALS.filter((goal) => goal !== 'maintain'),
];

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
 * which is also why changing the goal with the message box EMPTY costs no model
 * call — the action recomputes and returns before it would reach one. With text
 * typed, either button spends a call, because both submit the one form and the
 * action cannot tell which was pressed.
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
 * there is no write path for it, and the cost is that the conversation ends with
 * the page — which is stated to the user rather than left to be discovered.
 *
 * AI-NOTE: this used to cite the absence as what made "a jailbroken box cannot
 *          persist anything" a guarantee. ADR 0030 retired that sentence — the
 *          box keeps short validated notes now, listed and deletable on
 *          Settings — and the empty-state copy below says so. The transcript
 *          itself is still not stored.
 *
 * Everything that constrains the coach is on the server. Nothing here is a
 * control.
 */
/**
 * The action as this form calls it — two guards the server cannot give itself.
 *
 * **The clip is never sent back.** FOUND IN REVIEW, and it broke the tab.
 * `useActionState` passes the previous state as the action's first argument,
 * and a server action serialises every argument into the POST body — so the
 * last reply's audio rode along on the NEXT submission. Next rejects an action
 * body over 1 MB, and uncompressed speech is about 48 kB a second, so after any
 * spoken reply longer than about twenty seconds every later Send, goal change
 * and Clear failed with a 413 before the action ran. The state never changed,
 * so it stayed broken until a reload. Nothing on the server reads
 * `previous.audio` either; it is sent as `null`.
 *
 * **A failed request becomes an inline error, not a replaced page.** The
 * action's own try cannot see a request that never arrived — offline, a 502, a
 * function the platform killed at its ceiling. React rethrows a rejected action
 * during render, the nearest boundary is the route's, and the transcript lives
 * only in this state. `SessionCoach.tsx` carries the identical guard, rated
 * critical in its own review.
 */
async function ask(previous: CoachState, formData: FormData): Promise<CoachState> {
  const sent: CoachState = { ...previous, audio: null };
  return askTheCoach(sent, formData).catch((): CoachState => ({
    ...previous,
    audio: null,
    silent: null,
    coach: null,
    error: 'That did not get through. Try again in a moment.',
  }));
}

export function CoachBox({ goal, voiceName }: { goal: DietGoal; voiceName: string | null }) {
  /*
   * The STORED goal is the initial state — ADR 0032 §3, and until it existed
   * this opened on 'maintain' every time regardless of what the user had said.
   * A selector whose value survives one request is what that column was added
   * to fix, and reading it here is the half that makes the column real rather
   * than write-only.
   */
  const [state, formAction, pending] = useActionState<CoachState, FormData>(ask, {
    ...EMPTY_COACH,
    goal,
  });

  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  /*
   * The voice switch — rework PR 6, ADR 0031 §3 on its second surface. Off by
   * default and for this page only: nothing is saved, and a user who turns it on
   * has chosen to spend for THIS conversation, not for every visit.
   */
  const [speak, setSpeak] = useState(false);

  /*
   * The same playback the session card uses — `src/ui/reply-voice.ts`, which
   * carries three findings from that card's reviews: pause before an early
   * return, a guard on the play() rejection, and a recoverable autoplay refusal.
   */
  const { blocked, play, replay } = useReplyVoice();
  const [unplayable, setUnplayable] = useState(false);

  /*
   * One clip per ANSWER. `state` is a new object each time the action resolves
   * and the same object on every other render, so this plays once per reply and
   * never on typing. `useActionState` queues this form's submissions, so replies
   * cannot land out of order and there is no request generation to guard here —
   * the session card needs one because its recogniser can fire twice per hold.
   *
   * A text-only answer still calls `play(null)`, which STOPS the previous clip:
   * a spoken reply must not carry on talking over the next one's words.
   */
  /*
   * A LAYOUT effect, not a passive one — FOUND IN REVIEW. A passive effect runs
   * after paint, so for one frame the new answer showed the PREVIOUS answer's
   * "tap again to play" or "the voice did not come through". It cleared itself,
   * but a `role="status"` line announcing the wrong thing for a frame is still
   * announced.
   *
   * Keyed on `state`, which is a new object each time the action resolves and
   * the same object on every other render — the switch, `pending`, `blocked` —
   * so a clip plays once per reply. A non-answer submission (a goal change,
   * Clear, a message too long) returns no audio, so it STOPS the last clip:
   * intended, and consistent with how `row` behaves.
   */
  useLayoutEffect(() => {
    setUnplayable(false);
    play(state.audio, () => setUnplayable(true));
  }, [state]);
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
          {/*
           * `.settings-form` for its grid and its `label { display: block }`,
           * on a div rather than a form: the goal control posts through the one
           * form that wraps this whole component, and a nested <form> is invalid
           * HTML that browsers resolve by dropping the inner one — which would
           * take the select's own submit button with it.
           */}
          <div className="settings-form">
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
            is. It can only see the figures on your Profile and History tabs. The conversation
            itself is not kept — it ends when you leave this page — but the coach may keep a short
            note about something you tell it. Settings lists every one, and you can delete them.
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

                {/*
                 * From the server's flag, not by recognising the constant's
                 * text: a user who typed that sentence would otherwise get the
                 * link under their own turn, and importing the constant pulls
                 * the whole stage — prompts, guards, safety — into the client
                 * bundle. See `coach-state.ts`.
                 */}
                {state.supplementMiss && i === state.turns.length - 1 ? (
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

        {/*
         * Why the newest reply was not heard — every state renders something,
         * docs/specs/mobile-interface.md §4. `not-asked` says nothing: the switch
         * was off, which is not a failure.
         */}
        {state.silent !== null && state.silent !== 'not-asked' ? (
          <p className="muted small" role="status">
            {SILENT_TEXT[state.silent]}
          </p>
        ) : null}
        {unplayable ? (
          <p className="muted small" role="status">
            {SILENT_TEXT.failed}
          </p>
        ) : null}
        {blocked ? (
          /*
           * The browser withheld sound after the wait for the reply — the common
           * case on a phone. The clip is paid for and cached, and a press is what
           * the autoplay policy is waiting for.
           *
           * The SENTENCE is the spec's (§4) and the Try button's on the card
           * above. It replaces the voice name rather than sitting beside it —
           * FOUND IN REVIEW: naming a voice the user has not heard is the claim
           * the session card already avoids, and it shows one or the other.
           */
          <>
            <p className="muted small" role="status">
              {BLOCKED_TEXT}
            </p>
            <button type="button" className="secondary" onClick={() => void replay()}>
              Tap to play
            </button>
          </>
        ) : state.audio !== null && state.coach !== null && !unplayable ? (
          <p className="muted small">In {state.coach}’s voice.</p>
        ) : null}

        <div className="chat-form">
          {/*
           * Before the box, because it decides what the next Send costs. It
           * affects the NEXT answer only — the transcript above holds replies
           * that were never spoken, and turning this on does not read them out.
           *
           * The hidden field is what the action reads: the switch itself is a
           * switch checkbox with no `name`, so it cannot post anything a
           * hand-written request could not.
           */}
          {/*
           * WHOSE voice, before it is turned on — what the plan asked for, and the
           * first version said only after a clip had arrived. The name is known
           * up front now: it is the stored coach, resolved against the voiced
           * rows the same way `performReply` resolves it, so the label and the
           * voice cannot disagree.
           */}
          <SpeakSwitch
            speak={speak}
            onChange={setSpeak}
            describedBy="coach-speak-cost"
            label={
              voiceName === null
                ? 'Read the answers aloud'
                : `Read the answers aloud — ${voiceName}`
            }
            next
          />
          {speak ? <input type="hidden" name="speak" value="on" /> : null}
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
            <button type="submit" name="intent" value="ask" disabled={pending}>
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
