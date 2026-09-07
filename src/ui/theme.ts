/**
 * The appearance choices, in the order they are offered.
 *
 * One list, used by the Zod enum that validates the form, the radio group that
 * renders it, and the layout that stamps it onto `<html>`. Adding a fourth
 * theme should be this array and two blocks in `app/globals.css`.
 */
export const THEMES = ['system', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

export function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value);
}

/**
 * What goes in `<html data-theme>`.
 *
 * INVARIANT: 'system' stamps nothing. The attribute exists to override
 *            `prefers-color-scheme`, and an attribute that said "system" would
 *            have to be matched by a rule that then could not lose to the media
 *            query — see the two palette blocks in app/globals.css.
 */
export function themeAttribute(theme: string): Theme | undefined {
  return theme === 'light' || theme === 'dark' ? theme : undefined;
}
