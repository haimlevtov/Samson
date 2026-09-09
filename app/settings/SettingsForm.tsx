'use client';

import { useActionState } from 'react';
import { HUMOR_LEVELS } from '@/src/persona/schema';
import { THEMES } from '@/src/ui/theme';
import { MAX_DISPLAY_NAME } from '@/src/db/leaderboard';
import { SEXES, type Sex } from '@/src/diet/biometrics';
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

/** The three the column constrains, in the user's words rather than the schema's. */
const SEX_LABEL: Record<Sex, string> = {
  male: 'Male',
  female: 'Female',
  unspecified: 'Prefer not to say',
};

export function SettingsForm({
  displayName,
  timezone,
  humorMaxLevel,
  theme,
  timezones,
  leaderboardOptOut,
  bodyweightKg,
  heightCm,
  birthDate,
  sex,
  maxBirthDate,
}: {
  displayName: string;
  timezone: string;
  humorMaxLevel: string;
  theme: string;
  timezones: string[];
  leaderboardOptOut: boolean;
  bodyweightKg: number | null;
  heightCm: number | null;
  birthDate: string | null;
  sex: Sex | null;
  /**
   * Today in the user's own timezone — CLAUDE.md #9, computed on the server.
   *
   * WHY passed in rather than `new Date()` here: this is a client component, so
   * a date built here would be the DEVICE's, and the picker would disagree with
   * the action's own check for a user whose phone is in another zone.
   */
  maxBirthDate: string;
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
          maxLength={MAX_DISPLAY_NAME}
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

      {/*
       * ADR 0024 — the diet advisor needs all four, and until phase 6 nothing in
       * the app read or wrote any of them.
       *
       * WHY they are optional and say so: the app worked without them for five
       * phases and still does. Everything except the diet block is unaffected by
       * leaving them blank, and a required field would be a health question
       * somebody has to answer to change their theme.
       */}
      <fieldset>
        <legend className="label">You</legend>
        <p className="muted small">
          Only the diet advisor uses these, and only while you have it open. They are never sent to
          the coach model — it is told whether your target is a deficit, not what you weigh.
        </p>

        <label>
          <span className="label">Bodyweight (kg)</span>
          {/* inputMode decimal per docs/specs/mobile-interface.md: the phone
              keyboard opens on digits rather than letters. */}
          <input
            name="bodyweightKg"
            type="text"
            inputMode="decimal"
            defaultValue={bodyweightKg ?? ''}
            placeholder="Leave blank to skip"
            autoComplete="off"
          />
        </label>

        <label>
          <span className="label">Height (cm)</span>
          <input
            name="heightCm"
            type="text"
            inputMode="decimal"
            defaultValue={heightCm ?? ''}
            placeholder="Leave blank to skip"
            autoComplete="off"
          />
        </label>

        <label>
          <span className="label">Date of birth</span>
          <input name="birthDate" type="date" defaultValue={birthDate ?? ''} max={maxBirthDate} />
        </label>

        <label>
          <span className="label">Sex</span>
          {/*
           * A term in the Mifflin–St Jeor equation, which is why it is asked at
           * all and why the list is these three. "Prefer not to say" is a real
           * answer with a real behaviour rather than a null: it takes the higher
           * of the two constants, so the error lands on the side of more food —
           * ADR 0024 §3.
           */}
          <select name="sex" defaultValue={sex ?? ''}>
            <option value="">Not set</option>
            {SEXES.map((option) => (
              <option key={option} value={option}>
                {SEX_LABEL[option]}
              </option>
            ))}
          </select>
        </label>

        <p className="muted small">
          Kilograms and centimetres. Clearing a field removes it, and the diet advisor will say
          which one it is waiting for.
        </p>
      </fieldset>

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
         *
         * The inference caveat is there because this is the one place the app
         * makes a factual privacy claim to a user, at the moment they decide.
         * "Not your sessions" alone was true of the columns and false of what
         * can be worked out from them — ADR 0016, "What this does not
         * guarantee". FOUND IN REVIEW, 2026-09-07.
         */}
        <p className="muted small">
          Other people see your display name and your total XP — not your email and not your
          sessions, though a total that only ever rises means roughly when you last trained can be
          inferred from it. Without a display name you are not listed at all.
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
