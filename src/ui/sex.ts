/**
 * How the three values of `users.sex` are offered, in the user's words.
 *
 * One definition because there are two surfaces. Settings has always had this
 * map; `/welcome` rendered the raw column values instead, so its control read
 * "Prefer not to say / male / female / unspecified" — four options, two of them
 * meaning the same thing and only one of those two counting as an answer. That
 * is what the owner saw and asked about.
 *
 * The owner's words were "male or female only". Taken literally that is two
 * options and no way to decline, which this project will not ask for in a health
 * profile — and it does not need to, because the third value already exists with
 * a defined behaviour (ADR 0024 §3: `unspecified` takes the higher of the two
 * Mifflin constants, so it never under-feeds anybody). The two SEXES on offer
 * are the two; the third option is named as a declining rather than as a sex.
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
