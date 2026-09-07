/**
 * What the settings form hands back.
 *
 * WHY it reports success as well as failure, unlike the template forms: nothing
 * navigates when you save your settings. You stay on the page you were on, and
 * without a word from the server, "Save" and "do nothing" look identical.
 */
export interface SettingsFormState {
  error: string | null;
  saved: boolean;
}

export const EMPTY_SETTINGS_FORM: SettingsFormState = { error: null, saved: false };
