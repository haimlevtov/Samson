'use client';

import { useActionState } from 'react';
import { DIET_GOALS } from '@/src/diet/energy';
import { BIRTH_DATE_FIELDS, BIRTH_MONTH_OPTIONS } from '@/src/onboarding/schema';
import { canHear, whyShown } from '@/src/speech/player';
import { CoachTryButton, SHOWN_TEXT, useCoachVoice } from '../coach/CoachTry';
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

/**
 * The days a month can have. Thirty-one always, because which months are short
 * is `isRealDate`'s business — 31 February composes fine and is refused there,
 * with a message that already exists. Narrowing this list per month would be a
 * second definition of a real date, in a component, that leap years would then
 * have to be taught about.
 */
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));

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

export function BodyStep({ years, carried }: { years: number[]; carried: string }) {
  const [state, action, pending] = useActionState(saveBiometrics, EMPTY_WELCOME);
  const value = (name: string) => state.values[name] ?? '';

  /*
   * FOUND IN THE BROWSER, and neither the unit suite nor any reviewer could have
   * seen it: **`defaultValue` on a `<select>` is read once, at mount.**
   *
   * React 19 resets an uncontrolled form after a function action resolves, and
   * for an `<input>` it also updates the `value` ATTRIBUTE on re-render — so the
   * text fields above come back filled. A `<select>`'s default lives on the
   * `selected` attribute of an option, which React does not rewrite after mount,
   * so the reset restores it to "nothing chosen".
   *
   * The effect: a refused step kept the weight and the height and silently
   * dropped the sex and the date. That is the INVARIANT this file exists for —
   * `welcome-state.ts` states it, and the header says keeping values is the whole
   * reason these are client components. It had been true of the sex select since
   * PR 4 — which shipped it — and survived PR 8 reworking that very control. It
   * was about to be true of three more.
   *
   * Keying on the echoed value remounts the select when — and only when — the
   * server sends a different one back, which is exactly when its default needs
   * re-reading.
   */
  const keyed = (name: string) => `${name}-${value(name)}`;

  /*
   * Every control is disabled while a submit is in flight — FOUND IN REVIEW, and
   * the sibling `CoachStep` in this file already did it for the same reason.
   *
   * `FormData` is captured at submit, before the pending render, so disabling
   * costs nothing. What it prevents: changing a select while "Saving…" is shown,
   * then having the refusal echo the value you submitted and remount the control
   * back to it. The later choice vanishes with nothing said — on the one step
   * whose whole purpose is not losing answers.
   */

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
            disabled={pending}
          />
        </label>
        <label>
          <span className="label">Height (cm)</span>
          <input
            type="text"
            inputMode="decimal"
            name="heightCm"
            defaultValue={value('heightCm')}
            disabled={pending}
          />
        </label>
        {/*
         * THREE SELECTS, not `<input type="date">` — the owner reported that the
         * date input would not take a year ending in zero. That was not
         * reproduced here and this does not pretend to explain it;
         * `src/onboarding/schema.ts` records what WAS established. Three selects
         * remove the browser's widget from the path, which is the fix whatever
         * the cause, and it is the better control on a phone besides: a date
         * input's segments are typed blind and its value stays empty until all
         * three are filled.
         *
         * A `fieldset`, because three controls answering one question need one
         * label between them — three `<label>`s would announce as three
         * questions.
         */}
        <fieldset className="birth-date">
          <legend className="label">Date of birth</legend>
          <label>
            <span className="sr-only">Day</span>
            <select
              key={keyed('birthDay')}
              name={BIRTH_DATE_FIELDS.day}
              defaultValue={value('birthDay')}
              disabled={pending}
            >
              <option value="">Day</option>
              {DAYS.map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Month</span>
            <select
              key={keyed('birthMonth')}
              name={BIRTH_DATE_FIELDS.month}
              defaultValue={value('birthMonth')}
              disabled={pending}
            >
              <option value="">Month</option>
              {BIRTH_MONTH_OPTIONS.map((month) => (
                // Value and label from one record, never an array index — a
                // reordered list must not become a wrong birth date.
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Year</span>
            <select
              key={keyed('birthYear')}
              name={BIRTH_DATE_FIELDS.year}
              defaultValue={value('birthYear')}
              disabled={pending}
            >
              <option value="">Year</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
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
          <select
            key={keyed('sex')}
            name="sex"
            defaultValue={value('sex')}
            required
            disabled={pending}
          >
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
   * keys everything by slug, so six buttons share it and a second press joins
   * the call already in flight rather than paying twice.
   *
   * FOUND IN REVIEW: this comment used to add "and changing coach supersedes a
   * press that has not landed", which describes `select()` — a call the Coach
   * tab makes on its picker and this component deliberately does not make.
   * Picking a radio here is independent of the audio: the Try button owns
   * playback, and somebody choosing their coach while listening to another
   * should not be cut off mid-sentence. Superseding happens between PRESSES.
   */
  const { voice, hear, stop } = useCoachVoice();

  return (
    <>
      <Problem state={state} />
      <form action={action} className="welcome-form">
        <fieldset className="coach-set">
          <legend className="label">Pick a coach</legend>
          {coaches.map((coach) => {
            const why = whyShown(voice, coach, voiceAvailable);

            return (
              /*
               * A row, with the label around the radio and its text and
               * everything else OUTSIDE it. A button inside a label activates
               * the label's control, so pressing Try would also pick that coach;
               * and a `role="status"` sentence inside one joins the radio's
               * ACCESSIBLE NAME, so with no key configured all six radios would
               * be announced with "The coach voices are not set up here" on the
               * end of them. Both found in review, one after the other.
               */
              <div key={coach.slug} className="row coach-row">
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
                  </span>
                </label>

                {/*
                 * A button or a sentence, never both and never neither —
                 * `canHear` and `whyShown` are complements, which is why they
                 * live together in src/speech/player.ts rather than being
                 * written out per surface.
                 */}
                {canHear(coach, voiceAvailable) ? (
                  <CoachTryButton
                    slug={coach.slug}
                    name={coach.name}
                    voice={voice}
                    hear={hear}
                    stop={stop}
                    className="secondary"
                  />
                ) : why === null ? null : (
                  <span className="muted small coach-why" role="status">
                    {SHOWN_TEXT[why]}
                  </span>
                )}
              </div>
            );
          })}
        </fieldset>
        {/*
         * What pressing Try costs, said before it is pressed — ADR 0025's budget
         * section, and ADR 0031 §3's rule that a feature able to spend the key
         * in one session is not something to offer silently. Six buttons on the
         * first screen a new user sees is the most exposed this has ever been.
         */}
        <p className="muted small">
          Hearing a coach uses a little of the week&apos;s coaching budget, which is shared with
          your plans and your questions. Try the one or two you are choosing between.
        </p>
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
