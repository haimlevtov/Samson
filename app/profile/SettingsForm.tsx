'use client';

import { useActionState } from 'react';
import { HUMOR_LEVELS } from '@/src/persona/schema';
import { updateSettings } from './actions';
import { EMPTY_PROFILE_FORM, type ProfileFormState } from './form-state';

/** What each level actually buys, in the user's terms rather than the schema's. */
const HUMOR_BLURB: Record<string, string> = {
  clean: 'No jokes. Straight coaching.',
  cheeky: 'Light ribbing. The default.',
  crude: 'Everything the personas have.',
};

export function SettingsForm({
  displayName,
  timezone,
  humorMaxLevel,
  timezones,
}: {
  displayName: string;
  timezone: string;
  humorMaxLevel: string;
  timezones: string[];
}) {
  const [state, action, saving] = useActionState<ProfileFormState, FormData>(
    updateSettings,
    EMPTY_PROFILE_FORM
  );

  return (
    <form action={action} className="settings-form">
      <label>
        <span className="label">Display name</span>
        <input
          name="displayName"
          type="text"
          maxLength={60}
          defaultValue={displayName}
          placeholder="What the coach should call you"
          autoComplete="nickname"
        />
      </label>

      <label>
        <span className="label">Timezone</span>
        {/*
         * A list rather than a text field: this string decides what "today"
         * means for every streak and calendar achievement (CLAUDE.md #9), and a
         * typo in it is invisible until a streak breaks for no reason.
         */}
        <select name="timezone" defaultValue={timezone}>
          {timezones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="humor">
        <legend className="label">How rude the coach may be</legend>
        {HUMOR_LEVELS.map((level) => (
          <label key={level} className="humor-choice">
            <input
              type="radio"
              name="humorMaxLevel"
              value={level}
              defaultChecked={level === humorMaxLevel}
            />
            <span>
              <strong>{level}</strong>
              <span className="muted small"> — {HUMOR_BLURB[level]}</span>
            </span>
          </label>
        ))}
        <p className="muted small">
          A ceiling, not a setting: a persona pitched below it stays below it.
        </p>
      </fieldset>

      <div className="settings-submit">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {/* Nothing navigates on save, so the page has to say so itself. */}
        {state.saved ? (
          <span className="saved small" role="status">
            Saved
          </span>
        ) : null}
      </div>

      {state.error ? <p className="error small">{state.error}</p> : null}
    </form>
  );
}
