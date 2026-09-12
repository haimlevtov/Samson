'use client';

import { useActionState } from 'react';
import { SEXES } from '@/src/diet/biometrics';
import { DIET_GOALS } from '@/src/diet/energy';
import { SEX_LABEL } from '@/src/ui/sex';
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
           * The owner asked for "male or female only", and what was here was
           * worse than either reading of that: a blank "Prefer not to say" on
           * top of SEXES rendered raw, so the list read Prefer not to say /
           * male / female / unspecified. Two of those four mean the same thing,
           * and only one of the two counts as an answer — blank writes null,
           * which leaves the step unanswered and re-renders it with no message.
           *
           * So: the two sexes, labelled, and `unspecified` offered as the
           * declining it is rather than as a word from the schema. No blank
           * option — declining to say is a value here, and Skip is the way past
           * the step entirely.
           */}
          <select name="sex" defaultValue={value('sex') === '' ? 'unspecified' : value('sex')}>
            {SEXES.map((option) => (
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
export function CoachStep({ coaches, carried }: { coaches: CoachChoice[]; carried: string }) {
  const [state, action, pending] = useActionState(saveCoach, EMPTY_WELCOME);

  return (
    <>
      <Problem state={state} />
      <form action={action} className="welcome-form">
        <fieldset className="coach-set">
          <legend className="label">Pick a coach</legend>
          {coaches.map((coach) => (
            <label key={coach.slug} className="coach-choice">
              <input
                type="radio"
                name="personaSlug"
                value={coach.slug}
                required
                disabled={pending}
              />
              <span>
                <strong>{coach.name}</strong>
                {/* The row's own words. Rendered as text, never as markup. */}
                {coach.sampleLine === null ? null : (
                  <span className="muted small">{coach.sampleLine}</span>
                )}
              </span>
            </label>
          ))}
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
