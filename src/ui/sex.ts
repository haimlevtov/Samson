/**
 * How the values of `users.sex` are offered, in the user's words.
 *
 * One definition because there are two surfaces. Settings has always had this
 * map; `/welcome` rendered the raw column values instead, so its control read
 * "Prefer not to say / male / female / unspecified" — four entries, two of them
 * meaning the same thing and only one of those two counting as an answer.
 *
 * INVARIANT: a label for every value `SEXES` admits, asserted in sex.test.ts. A
 *            missing one renders the bare column value, which is exactly how the
 *            welcome step came to show somebody the word "unspecified".
 */
import type { Sex } from '../diet/biometrics';

export const SEX_LABEL: Record<Sex, string> = {
  male: 'Male',
  female: 'Female',
  unspecified: 'Prefer not to say',
};

/**
 * What the WELCOME step offers: male and female, and nothing else.
 *
 * OWNER'S DECISION, and it overrules what this file argued for first. An earlier
 * version of this module offered `unspecified` as a third option, on the ground
 * that a health profile should carry a way to decline. The owner's instruction
 * was "for sex do only 2 options, this is for scientific calculation, its a
 * must", and that is the right call on the merits: `mifflinStJeor` selects a
 * constant by sex, so the number the diet block shows is only as honest as the
 * answer behind it. `unspecified` takes the male constant (ADR 0024 §3) — safe,
 * in that it never under-feeds anybody, and still a figure computed from a value
 * nobody stated.
 *
 * WHY the control needs an unselected placeholder as well: a two-option
 * `<select>` with no placeholder preselects the first, so a user who never
 * looked at the field would be recorded as male. The step is REQUIRED and starts
 * on nothing, so the two values are the only two that can be submitted and
 * neither can be submitted by accident. Skip is still the way past the step.
 *
 * AI-NOTE: do not put `unspecified` back on this control without the owner. It
 *          remains a valid COLUMN value — Settings offers it, the CHECK admits
 *          it, and `src/diet/energy.ts` has a constant for it — because rows
 *          already carry it and a settings form must be able to show what is
 *          stored. The ban is on collecting it here.
 */
export const WELCOME_SEXES = ['male', 'female'] as const satisfies readonly Sex[];
