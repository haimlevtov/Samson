/**
 * What onboarding's biometrics step may submit — ADR 0032 §2.
 *
 * INVARIANT: the BOUNDS have one home and it is `src/diet/biometrics.ts`. This
 *            composes the same field builders `settingsSchema` composes, so
 *            there are two compositions of one definition rather than two
 *            definitions. A change to what a plausible height is happens in one
 *            place and reaches both.
 *
 * WHY not reuse `settingsSchema` itself: it also requires a timezone, a theme, a
 * humour ceiling and a display name, none of which this step asks for — and
 * `readSettingsForm`'s AI-NOTE is explicit that a surface writing these fields
 * must not post a SUBSET of that form. This posts its own whole form instead,
 * which is the other half of that instruction.
 */
import { z } from 'zod';
import {
  BODYWEIGHT_SCALE,
  EARLIEST_BIRTH_DATE,
  HEIGHT_SCALE,
  MAX_BODYWEIGHT_KG,
  MAX_HEIGHT_CM,
  SEXES,
  birthDateField,
  measurementField,
} from '../diet/biometrics';

export const onboardingBodySchema = z.strictObject({
  bodyweightKg: measurementField(MAX_BODYWEIGHT_KG, 'kg', BODYWEIGHT_SCALE),
  heightCm: measurementField(MAX_HEIGHT_CM, 'cm', HEIGHT_SCALE),
  birthDate: birthDateField(),
  sex: z.preprocess((value) => (value === '' ? null : value), z.enum(SEXES).nullable()),
});

export type OnboardingBody = z.infer<typeof onboardingBodySchema>;

/** The same four, with none of them absent. */
export type CompleteOnboardingBody = {
  [K in keyof OnboardingBody]: NonNullable<OnboardingBody[K]>;
};

/**
 * All four, or none of them counts — and `app/welcome/page.tsx` has said so
 * since the flow shipped: *"All four or none: a partial profile is what its
 * three refusals are about, and the step asks for all four together."*
 *
 * The code did not enforce it, and the gap was a silent loop rather than an
 * untidy comment. Every field here is nullable, so three answers PARSE; the
 * upsert succeeds; `hasBiometrics` stays false because it wants all four; and
 * `/welcome` re-renders the same step with empty boxes and nothing said. The
 * user's own answers are off the screen with no explanation of why.
 *
 * WHY here rather than as a `.refine` on the schema: the caller needs to tell
 * this refusal from a BOUNDS refusal, because they are different sentences —
 * "that did not look right" is wrong for four perfectly good answers, and ADR
 * 0028 is about exactly that distinction. A predicate the action can branch on
 * keeps both messages in the caller's hands.
 *
 * WHY here rather than in the action: nothing under `app/` is in the unit
 * suite — `vitest.config.ts` includes `src/**` and `tests/unit/**` — so a rule
 * written there is a rule nothing can fail on.
 */
export function isCompleteBody(body: OnboardingBody): body is CompleteOnboardingBody {
  return (
    body.bodyweightKg !== null &&
    body.heightCm !== null &&
    body.birthDate !== null &&
    body.sex !== null
  );
}

/**
 * The three parts a date of birth is asked for as — rework PR 9.
 *
 * WHY not `<input type="date">`, which is what this was. The owner reported that
 * the welcome step would not take a year ending in zero, and the behaviour was
 * not reproduced here — what WAS established is that `birthDateField` accepts
 * 1990 and 2000, and that the control carried no `min` and no `max`, so whatever
 * happened was inside the browser's own widget. Three selects remove the widget
 * from the path, which is the fix regardless of the cause.
 *
 * It is also the better control on a phone: a native date input's segments are
 * typed blind, its `value` stays empty until all three are filled, and nothing
 * about either is visible.
 */
export interface BirthDateParts {
  day: string;
  month: string;
  year: string;
}

/** How the months are offered. The VALUE is the number; this is the label. */
export const BIRTH_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The earliest year the bounds admit — `EARLIEST_BIRTH_DATE` is 1900-01-01. */
export const EARLIEST_BIRTH_YEAR = Number(EARLIEST_BIRTH_DATE.slice(0, 4));

/**
 * The years to offer, newest first, for somebody whose local date is `today`.
 *
 * NEWEST FIRST because a birth year is nearly always recent-ish: ascending from
 * 1900 puts most people ninety options down a list.
 *
 * BOUNDED BY TODAY because `isFutureBirthDate` refuses a future date, and
 * `docs/specs/mobile-interface.md` — with Settings' own date input saying it in
 * as many words — is that a picker must not offer what the save will refuse.
 *
 * INVARIANT: `today` is the USER's local date, computed on the server — CLAUDE.md
 *            #9. A year built in the component would be the device's, and
 *            somebody whose phone is in another timezone would get a list that
 *            disagrees with the action's own check. The same reasoning Settings
 *            records for `maxBirthDate`.
 */
export function birthYears(today: string): number[] {
  const latest = Number(today.slice(0, 4));
  const years: number[] = [];
  for (let year = latest; year >= EARLIEST_BIRTH_YEAR; year--) years.push(year);
  return years;
}

/** What three selects add up to. */
export interface ComposedBirthDate {
  /** The ISO date, or '' for "not answered" — which is what blank means here. */
  iso: string;
  /** Some parts answered and not others, which is neither a date nor a blank. */
  partial: boolean;
}

/**
 * Joins three selects into the ISO date `birthDateField` already validates.
 *
 * THREE OUTCOMES, and the third is the one a single input could not have:
 *
 * - none of them chosen → `''`, which the schema reads as null. The four-or-none
 *   guard then asks for all four fields, which is the right message.
 * - all three chosen → `YYYY-MM-DD`. Whether that date EXISTS is not decided
 *   here: 31 February composes fine and `isRealDate` refuses it, with a message
 *   that already exists. One definition of a real date, not two.
 * - some chosen → `partial`. Treating that as blank would silently discard two
 *   answers the user gave, which is the shape of loop PR 8 spent a section on.
 *
 * Pure, and in `src/` rather than the action, because nothing under `app/` is in
 * the unit suite — `vitest.config.ts` includes `src/**` and `tests/unit/**`.
 */
export function composeBirthDate(parts: BirthDateParts): ComposedBirthDate {
  const given = [parts.day, parts.month, parts.year].filter((part) => part.trim() !== '');
  if (given.length === 0) return { iso: '', partial: false };
  if (given.length < 3) return { iso: '', partial: true };

  // Zero-padded, because `isRealDate` requires the ISO shape and `ageOn` slices
  // fixed offsets out of the string — an unpadded date reads the wrong year.
  const pad = (value: string) => value.trim().padStart(2, '0');
  return { iso: `${parts.year.trim()}-${pad(parts.month)}-${pad(parts.day)}`, partial: false };
}

/** What a partial date is told, in the app's own words — ADR 0028. */
export const PARTIAL_BIRTH_DATE_MESSAGE =
  'Choose a day, a month and a year — or leave all three and skip this step.';

/** What a partial answer is told, in the app's own words — ADR 0028. */
export const INCOMPLETE_BODY_MESSAGE =
  'The coach needs all four of these to work out a calorie target. Fill in the rest, or skip this step.';

/**
 * A field the form sent, or `undefined` when it sent no such field at all.
 *
 * The same reader `readSettingsForm` uses, and for the same reason it records:
 * these four treat blank as "clear this", so a POST that simply OMITS one is
 * indistinguishable from one clearing it. `undefined` fails the schema with a
 * message naming the field; `''` clears it deliberately. The real form always
 * sends all four — a blank text input posts `''` and a `<select>` posts its
 * current value — so only a hand-written request reaches the difference.
 */
function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return value === null ? undefined : String(value);
}

export function readBodyForm(formData: FormData): Record<string, unknown> {
  return {
    bodyweightKg: field(formData, 'bodyweightKg'),
    heightCm: field(formData, 'heightCm'),
    // Composed from three selects — rework PR 9. `undefined` when the form sent
    // none of the three at all, which is the hand-written-request case `field`
    // exists to keep distinguishable from a deliberate blank.
    birthDate: composeBirthDate(readBirthDateParts(formData)).iso,
    sex: field(formData, 'sex'),
  };
}

/** The three fields the control posts, as strings. */
export function readBirthDateParts(formData: FormData): BirthDateParts {
  return {
    day: String(formData.get('birthDay') ?? ''),
    month: String(formData.get('birthMonth') ?? ''),
    year: String(formData.get('birthYear') ?? ''),
  };
}
