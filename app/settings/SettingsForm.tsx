'use client';

import { useActionState } from 'react';
import { HUMOR_LEVELS } from '@/src/persona/schema';
import { THEMES } from '@/src/ui/theme';
import { updateSettings } from './actions';
import { EMPTY_SETTINGS_FORM, type SettingsFormState } from './form-state';

/** What each theme does, said plainly. "System" is the one that needs saying. */
const THEME_BLURB: Record<string, string> = {
  system: 'Follow the phone',
  light: 'Always light',
  dark: 'Always dark',
};

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
  theme,
  timezones,
  leaderboardOptOut,
}: {
  displayName: string;
  timezone: string;
  humorMaxLevel: string;
  theme: string;
  timezones: string[];
  leaderboardOptOut: boolean;
}) {
  const [state, action, saving] = useActionState<SettingsFormState, FormData>(
    updateSettings,
    EMPTY_SETTINGS_FORM
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
        <legend className="label">Appearance</legend>
        {/* A segmented row rather than a switch: "on/off" cannot say "follow
            the phone", and following the phone is the right default. */}
        <div className="theme-choices">
          {THEMES.map((option) => (
            <label key={option} className="theme-choice">
              <input type="radio" name="theme" value={option} defaultChecked={option === theme} />
              <span>
                <strong>{option}</strong>
                <span className="muted small">{THEME_BLURB[option]}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="muted small">Applied on save, before the next page is drawn.</p>
      </fieldset>

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

      <fieldset>
        <legend className="label">Leaderboard</legend>
        <label className="check-row">
          <input type="checkbox" name="leaderboardOptOut" defaultChecked={leaderboardOptOut} />
          <span>Keep me off the leaderboard</span>
        </label>
        {/*
         * Says what is shared, not just that something is — ADR 0016 §2. A
         * privacy control that does not name the data it governs asks for
         * consent to an unknown.
         */}
        <p className="muted small">
          Other people see your display name and your total XP. Nothing else — not your email, not
          your sessions. Without a display name you are not listed at all.
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
