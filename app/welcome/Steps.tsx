'use client';

import { useActionState } from 'react';
import { DIET_GOALS } from '@/src/diet/energy';
import { whyShown } from '@/src/speech/player';
import { SHOWN_TEXT, useCoachVoice } from '../coach/coach-voice';
import { SEX_LABEL, WELCOME_SEXES } from '@/src/ui/sex';
import { saveBiometrics, saveCoach, saveGoal, saveName } from './actions';
import { EMPTY_WELCOME, type WelcomeState } from './welcome-state';

/**
 * The four steps that can be refused — ADR 0032 §2.
 *
 * WHY these are client components when the rest of `/welcome` is not: the rule
 * in `docs/specs/mobile-interface.md` §4 is that a rejected form KEEPS ITS
 * VALUES, and a server action that redirects cannot. `useActionState` carries
 * the sentence and the typed values back, which is what `updateSettings` and the
 * session console already do.
 *
 * FOUND IN REVIEW: the first version redirected on every failure, so one
 * out-of-range height cost the user their weight, height, date of birth and sex.
 *
 * The equipment and plan steps are not here — they reuse components that own
 * their own state (ADR 0029's picker, 8b's questionnaire), which is the point of
 * reusing them.
 */

/** The sentence a refusal renders. Never an upstream message — ADR 0028. */
function Problem({ state }: { state: WelcomeState }) {
  if (state.error === null) return null;
  return (
    <p className="error" role="status">
      {state.error}
    </p>
  );
}

export function NameStep({ carried }: { carried: string }) {
  const [state, action, pending] = useActionState(saveName, EMPTY_WELCOME);

  return (
    <>
      <Problem state={state} />
      <form action={action} className="welcome-form">
        <label>
          <span className="label">Your name</span>
          <input
            type="text"
            name="displayName"
            maxLength={60}
            autoFocus
            required
            defaultValue={state.values['displayName'] ?? ''}
          />
        </label>
        <input type="hidden" name="skipped" value={carried} />
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Continue'}
        </button>
      </form>
      {/* The only question with no skip — ADR 0032 §2. Said here rather than
          left to be discovered by looking for a button that is not there. */}
      <p className="muted small">This is the one thing we need.</p>
    </>
  );
}

export function BodyStep({ carried }: { carried: string }) {
  const [state, action, pending] = useActionState(saveBiometrics, EMPTY_WELCOME);
  const value = (name: string) => state.values[name] ?? '';

  return (
    <>
      <Problem state={state} />
      <form action={action} className="welcome-form">
        <label>
          <span className="label">Bodyweight (kg)</span>
          {/* `type="text"` with `inputMode="decimal"`, not `type="number"` —
              ADR 0029: a number input silently blanks what it cannot parse, so
              an unparseable value became an absent one. */}
          <input
            type="text"
            inputMode="decimal"
            name="bodyweightKg"
            defaultValue={value('bodyweightKg')}
          />
        </label>
        <label>
          <span className="label">Height (cm)</span>
          <input type="text" inputMode="decimal" name="heightCm" defaultValue={value('heightCm')} />
        </label>
        <label>
          <span className="label">Date of birth</span>
          <input type="date" name="birthDate" defaultValue={value('birthDate')} />
        </label>
        <label>
          <span className="label">Sex</span>
          {/*
           * TWO OPTIONS — the owner's instruction, and `src/ui/sex.ts` carries
           * why it is right: the BMR constant is selected by sex, so the number
           * the diet block shows is only as honest as the answer behind it.
           *
           * The empty option is a PLACEHOLDER, not a third answer. A two-option
           * select with no placeholder preselects the first, so a user who never
           * looked at this field would be recorded as male; `required` plus an
           * empty first option means the two values are the only two that can be
           * submitted, and neither can be submitted by accident. The server
           * refuses a blank anyway — `isCompleteBody` — because a required
           * attribute is a convenience, never a control.
           */}
          <select name="sex" defaultValue={value('sex')} required>
            <option value="">Choose one</option>
            {WELCOME_SEXES.map((option) => (
              <option key={option} value={option}>
                {SEX_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="skipped" value={carried} />
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </>
  );
}

/**
 * A coach as the picker lists it — rework PR 8.
 *
 * Three fields rather than `ListedPersona`, and the omission is the point:
 * `systemPrompt` is the character description the delivery stage fences into a
 * message, and there is no reason for a browser to hold it. A client component
 * receives what it renders.
 */
export interface CoachChoice {
  slug: string;
  name: string;
  /** The row's own line, spoken elsewhere and read here. Null for a row without one. */
  sampleLine: string | null;
  /**
   * Two sentences about the coach — `personas.bio`, rework PR 5.
   *
   * Shown here as well as on the Coach tab's menu, because this step asks the
   * same question that menu asks and a sample line alone demonstrates a coach
   * without describing one. Null for a row without a bio.
   */
  bio: string | null;
  /**
   * Whether `coachVoice` would speak this one — a shared row with a voice, a
   * direction and a line. The Try button is offered only when it is true: a
   * button that cannot speak is not shown (mobile-interface.md §4).
   */
  voiced: boolean;
}

/**
 * Step 2 — which coach, the one question in this flow that is about taste.
 *
 * WHY radio cards rather than a `<select>` like the other two: a coach is
 * chosen by how they sound, and the sample line is the only thing on the screen
 * that conveys that. A dropdown shows one name at a time and hides the reason to
 * prefer any of them.
 *
 * `required` on the group, so the browser refuses an empty submit before a round
 * trip. The action checks the slug against the persona rows regardless — a
 * required attribute is a convenience, never a control.
 */
export function CoachStep({
  coaches,
  voiceAvailable,
  carried,
}: {
  coaches: CoachChoice[];
  /** Whether the server can speak at all — false with no key configured. */
  voiceAvailable: boolean;
  carried: string;
}) {
  const [state, action, pending] = useActionState(saveCoach, EMPTY_WELCOME);

  /*
   * ONE player for the whole list, from the same hook the Coach tab uses. It
   * keys everything by slug — `fetching`, `playing` and `shown` all name a
   * coach — so six buttons share it, a second press joins the call already in
   * flight rather than paying twice, and changing coach supersedes a press that
   * has not landed.
   */
  const { voice, hear, stop } = useCoachVoice();

  return (
    <>
      <Problem state={state} />
      <form action={action} className="welcome-form">
        <fieldset className="coach-set">
          <legend className="label">Pick a coach</legend>
          {coaches.map((coach) => {
            const canHear = voiceAvailable && coach.voiced && (coach.sampleLine ?? '') !== '';
            const why = whyShown(voice, coach, voiceAvailable);
            const fetching = voice.fetching === coach.slug;

            return (
              /*
               * A row, with the label around the radio and its text and the Try
               * button OUTSIDE it. A button inside a label activates the label's
               * control, so pressing Try would also pick that coach — a side
               * effect nobody asked for, and a nested interactive element a
               * screen reader has to guess at.
               */
              <div key={coach.slug} className="coach-row">
                <label className="choice-row coach-choice">
                  {/* Keeps the pick through a refusal — mobile-interface.md §4.
                      React 19 resets an uncontrolled form once a function action
                      resolves, so without this a transient save failure clears
                      the choice and six bios have to be read again. */}
                  <input
                    type="radio"
                    name="personaSlug"
                    value={coach.slug}
                    defaultChecked={state.values['personaSlug'] === coach.slug}
                    required
                    disabled={pending}
                  />
                  <span>
                    <strong>{coach.name}</strong>
                    {/* Both are the row's own words, rendered as text and never
                        as markup. The bio says who they are; the line shows it. */}
                    {coach.bio === null ? null : <span className="muted small">{coach.bio}</span>}
                    {coach.sampleLine === null ? null : (
                      <span className="muted small coach-line">“{coach.sampleLine}”</span>
                    )}
                    {why === null ? null : (
                      // Every state renders something — mobile-interface.md §4.
                      <span className="muted small" role="status">
                        {SHOWN_TEXT[why]}
                      </span>
                    )}
                  </span>
                </label>

                {canHear ? (
                  voice.playing === coach.slug ? (
                    <button type="button" className="secondary" onClick={stop}>
                      Stop
                    </button>
                  ) : (
                    /*
                     * Stays enabled while fetching, like the Coach tab's:
                     * disabling the focused button drops keyboard focus, and a
                     * second press joins the call in flight rather than paying
                     * twice. The name is in the content rather than an
                     * `aria-label`, so the press is audible to a screen reader
                     * and the visible word is contained in the accessible name
                     * (WCAG 2.5.3) — six buttons reading "Try" would otherwise
                     * be six identical names.
                     */
                    <button
                      type="button"
                      className="secondary"
                      aria-busy={fetching}
                      onClick={() => hear(coach.slug)}
                    >
                      {fetching ? 'Finding…' : 'Try'}
                      <span className="sr-only"> {coach.name}’s voice</span>
                    </button>
                  )
                ) : null}
              </div>
            );
          })}
        </fieldset>
        <input type="hidden" name="skipped" value={carried} />
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Continue'}
        </button>
      </form>
      <p className="muted small">
        You can change your mind on the Coach tab. It changes how the coach talks to you, never what
        it tells you to lift.
      </p>
    </>
  );
}

export function GoalStep({ carried }: { carried: string }) {
  const [state, action, pending] = useActionState(saveGoal, EMPTY_WELCOME);

  return (
    <>
      <Problem state={state} />
      <form action={action} className="welcome-form">
        <label>
          <span className="label">Diet goal</span>
          <select name="goal" defaultValue="maintain">
            {DIET_GOALS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="skipped" value={carried} />
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </>
  );
}
