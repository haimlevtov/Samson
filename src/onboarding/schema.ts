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
    birthDate: field(formData, 'birthDate'),
    sex: field(formData, 'sex'),
  };
}
