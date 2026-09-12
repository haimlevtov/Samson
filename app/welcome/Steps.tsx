'use client';

import { useActionState } from 'react';
import { SEXES } from '@/src/diet/biometrics';
import { DIET_GOALS } from '@/src/diet/energy';
import { saveBiometrics, saveGoal, saveName } from './actions';
import { EMPTY_WELCOME, type WelcomeState } from './welcome-state';

/**
 * The three steps that can be refused — ADR 0032 §2.
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
          <select name="sex" defaultValue={value('sex')}>
            <option value="">Prefer not to say</option>
            {SEXES.map((option) => (
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
