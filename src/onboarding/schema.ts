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
  isRealDate,
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

/**
 * The names the three selects post under — spelled once, here, and read by the
 * control and by `readBirthDateParts` alike. FOUND IN REVIEW: they were written
 * out in both, so renaming one silently produced a blank date.
 */
export const BIRTH_DATE_FIELDS = {
  day: 'birthDay',
  month: 'birthMonth',
  year: 'birthYear',
} as const;

/**
 * How the months are offered, as value and label TOGETHER.
 *
 * FOUND IN REVIEW: this was a list of names, and the control derived each
 * option's value from its array POSITION. Reordering the list — alphabetically,
 * say — would have silently produced wrong birth dates, with nothing failing.
 * The value is the contract with `composeBirthDate`; the label is incidental.
 * `schema.test.ts` pins all twelve.
 *
 * It lives here rather than beside `SEX_LABEL` in `src/ui/` for that reason:
 * the number is what the composer reads, and a label list without its values
 * would re-open the position coupling.
 */
export const BIRTH_MONTH_OPTIONS = [
  { value: '1', label: 'January' },
  { value: '2', label: 'February' },
  { value: '3', label: 'March' },
  { value: '4', label: 'April' },
  { value: '5', label: 'May' },
  { value: '6', label: 'June' },
  { value: '7', label: 'July' },
  { value: '8', label: 'August' },
  { value: '9', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
] as const;

/** The earliest year the bounds admit — `EARLIEST_BIRTH_DATE` is 1900-01-01. */
export const EARLIEST_BIRTH_YEAR = Number(EARLIEST_BIRTH_DATE.slice(0, 4));

/**
 * The years to offer, newest first, for somebody whose local date is `today`.
 *
 * NEWEST FIRST because a birth year is nearly always recent-ish: ascending from
 * 1900 puts most people ninety options down a list.
 *
 * BOUNDED BY THE LOCAL YEAR, which is a weaker claim than Settings' input
 * makes and is said that way deliberately. That one carries `max={maxBirthDate}`
 * and is exact to the DAY; a list of years cannot be. So today's year is
 * offered, and a date later this year composes, parses, and is then refused by
 * `isFutureBirthDate` with its own sentence and every value echoed. That is a
 * recoverable refusal rather than the dead end the spec's rule is about — but it
 * IS a case where the picker offers something the save declines, and pretending
 * otherwise is how a comment stops being true. FOUND IN REVIEW.
 *
 * The rule itself — a picker should not offer what the save refuses — is written
 * at `app/settings/SettingsForm.tsx`'s date input. An earlier version of this
 * comment attributed it to `docs/specs/mobile-interface.md`, which does not
 * contain it.
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
  /**
   * The ISO date, '' for "not answered" — which is what blank means here — or
   * `undefined` when the form sent no date fields at all, which only a
   * hand-written request does.
   */
  iso: string | undefined;
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
export function composeBirthDate(parts: Partial<BirthDateParts>): ComposedBirthDate {
  const all = [parts.day, parts.month, parts.year];

  // NONE OF THE THREE SENT — a hand-written request, not a user. It composes to
  // `undefined` so the schema names the field, exactly as it does for a missing
  // bodyweight. A real form always posts all three, blank or not.
  if (all.every((part) => part === undefined)) return { iso: undefined, partial: false };

  const given = all.filter((part) => (part ?? '').trim() !== '');
  if (given.length === 0) return { iso: '', partial: false };
  if (given.length < 3) return { iso: '', partial: true };

  // Zero-padded, because `isRealDate` requires the ISO shape and `ageOn` slices
  // fixed offsets out of the string — an unpadded date reads the wrong year.
  const pad = (value: string | undefined) => (value ?? '').trim().padStart(2, '0');
  return {
    iso: `${(parts.year ?? '').trim()}-${pad(parts.month)}-${pad(parts.day)}`,
    partial: false,
  };
}

/**
 * Whether all three parts were chosen AND they name a date that exists.
 *
 * FOUND IN REVIEW, and it is a state the control this replaced could not reach:
 * the browser's date widget clamps the day to the month, and a list of 1–31 does
 * not. 31 February parses to a well-formed string and is then refused by
 * `isRealDate` — with `INVALID_MESSAGE`, "that did not look right", under four
 * controls of which three are fine. Nothing said which one to change, and
 * pressing Continue again reproduced it exactly: a loop.
 *
 * So the caller asks this and says something the user can act on.
 */
export function namesARealDate(parts: Partial<BirthDateParts>): boolean {
  const { iso, partial } = composeBirthDate(parts);
  if (partial || iso === undefined || iso === '') return true;
  return isRealDate(iso);
}

/** What an impossible date is told — ADR 0028, and it names the control. */
export const IMPOSSIBLE_DATE_MESSAGE = 'That day does not exist in that month. Check the day.';

/** What a partial date is told, in the app's own words — ADR 0028. */
export const PARTIAL_BIRTH_DATE_MESSAGE =
  'Choose a day, a month and a year — or clear all three and skip this step.';

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

/**
 * The three fields the control posts.
 *
 * `undefined` for a part the form did not send AT ALL, which is the distinction
 * `field` above exists to keep — and which this reader lost in its first
 * version, FOUND IN REVIEW. It coalesced a missing field to `''`, so a
 * hand-written POST omitting the date was indistinguishable from one clearing
 * it, while omitting the bodyweight still failed the schema by name. Three of
 * the four fields behaving one way and the fourth another is worse than either
 * rule.
 */
export function readBirthDateParts(formData: FormData): Partial<BirthDateParts> {
  const part = (name: string) => {
    const value = formData.get(name);
    return value === null ? undefined : String(value);
  };
  return {
    day: part(BIRTH_DATE_FIELDS.day),
    month: part(BIRTH_DATE_FIELDS.month),
    year: part(BIRTH_DATE_FIELDS.year),
  };
}
