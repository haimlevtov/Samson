/**
 * The settings form's schema and its reader, checked against each other.
 *
 * WHY this file exists rather than a case inside another suite: the bug it
 * guards against is not in either half, it is in the GAP between them. A field
 * declared in `settingsSchema` and absent from `readSettingsForm` parses as
 * `undefined` and fails EVERY save — not only the one that touches it — and
 * typecheck cannot see it, because the object handed to `safeParse` is an
 * untyped literal. That happened once, on `leaderboardOptOut`, and
 * `src/settings/schema.ts` carries the FOUND IN TESTING note.
 *
 * This is the class of bug, not the instance.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readSettingsForm, settingsSchema } from '../../src/settings/schema';

/** Every key the form sends, with a value that parses. */
function completeForm(): FormData {
  const form = new FormData();
  form.set('displayName', 'Noa');
  form.set('timezone', 'Asia/Jerusalem');
  form.set('humorMaxLevel', 'cheeky');
  form.set('theme', 'system');
  form.set('leaderboardOptOut', 'on');
  form.set('bodyweightKg', '62');
  form.set('heightCm', '166');
  form.set('birthDate', '2002-03-14');
  form.set('sex', 'female');
  return form;
}

describe('the schema and the reader carry the same keys', () => {
  const schemaKeys = Object.keys(settingsSchema.shape).sort();
  const readerKeys = Object.keys(readSettingsForm(new FormData())).sort();

  it('has no schema field the reader does not supply', () => {
    // A field only in the schema is permanently undefined: every save fails.
    expect(schemaKeys.filter((key) => !readerKeys.includes(key))).toEqual([]);
  });

  it('has no reader field the schema does not declare', () => {
    // A field only in the reader is silently dropped: the save succeeds and the
    // value never lands, which is the quieter half of the same bug.
    expect(readerKeys.filter((key) => !schemaKeys.includes(key))).toEqual([]);
  });

  /*
   * The third copy, and the one that used to go unchecked: the `name=`
   * attributes in the JSX.
   *
   * Comparing the reader against a fixture in this file proves only that the
   * fixture agrees with itself. The gap that matters is between the reader and
   * the form, and for the four biometrics a mismatch there is DESTRUCTIVE
   * rather than annoying: `name="bodyweight_kg"` instead of `name="bodyweightKg"`
   * makes `formData.get` return null, which the schema reads as "cleared", and
   * every save then writes null over a stored value — with this whole suite
   * green.
   *
   * Grepping the source is the pattern tests/unit/invariants.test.ts already
   * uses for the things a type cannot reach.
   */
  it('matches every name= the form actually renders', () => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'app', 'settings', 'SettingsForm.tsx'),
      'utf8'
    );
    const rendered = [...source.matchAll(/name="([A-Za-z]+)"/g)].map((match) => match[1]);

    expect(new Set(rendered)).toEqual(new Set(schemaKeys));
  });
});

describe('parsing a submission', () => {
  it('accepts a complete form', () => {
    const parsed = settingsSchema.safeParse(readSettingsForm(completeForm()));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      displayName: 'Noa',
      leaderboardOptOut: true,
      bodyweightKg: 62,
      heightCm: 166,
      birthDate: '2002-03-14',
      sex: 'female',
    });
  });

  it('reads an absent checkbox as false rather than undefined', () => {
    const form = completeForm();
    form.delete('leaderboardOptOut');
    const parsed = settingsSchema.safeParse(readSettingsForm(form));
    expect(parsed.success && parsed.data.leaderboardOptOut).toBe(false);
  });

  it('clears every biometric to null when its field is blank', () => {
    const form = completeForm();
    for (const field of ['bodyweightKg', 'heightCm', 'birthDate', 'sex']) form.set(field, '');

    const parsed = settingsSchema.safeParse(readSettingsForm(form));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toMatchObject({
      bodyweightKg: null,
      heightCm: null,
      birthDate: null,
      sex: null,
    });
  });

  it('rejects a zero weight rather than storing one', () => {
    const form = completeForm();
    form.set('bodyweightKg', '0');
    const parsed = settingsSchema.safeParse(readSettingsForm(form));
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]?.path).toEqual(['bodyweightKg']);
  });

  it('rejects a sex outside the three the column admits', () => {
    const form = completeForm();
    form.set('sex', 'other');
    expect(settingsSchema.safeParse(readSettingsForm(form)).success).toBe(false);
  });

  /*
   * The form posts nothing at all — a crafted request rather than the UI. Every
   * required field must fail loudly rather than writing a default over a stored
   * value.
   */
  it('rejects an empty submission instead of blanking the row', () => {
    const parsed = settingsSchema.safeParse(readSettingsForm(new FormData()));
    expect(parsed.success).toBe(false);
  });

  /*
   * FOUND IN REVIEW, and the empty-form case above did not cover it: a POST that
   * carries the four appearance fields and simply OMITS the biometrics used to
   * succeed and erase all four, because a missing key was read as `''` and `''`
   * means "clear this". The required fields fail loudly on absence; these were
   * the only ones where absence was silently destructive.
   */
  it('rejects a submission that omits a biometric rather than clearing it', () => {
    for (const omitted of ['bodyweightKg', 'heightCm', 'birthDate', 'sex']) {
      const form = completeForm();
      form.delete(omitted);

      const parsed = settingsSchema.safeParse(readSettingsForm(form));
      expect(parsed.success, `omitting ${omitted} must not succeed`).toBe(false);
    }
  });

  it('still distinguishes an omitted field from a cleared one', () => {
    const cleared = completeForm();
    cleared.set('bodyweightKg', '');
    expect(settingsSchema.safeParse(readSettingsForm(cleared)).success).toBe(true);

    const omitted = completeForm();
    omitted.delete('bodyweightKg');
    expect(settingsSchema.safeParse(readSettingsForm(omitted)).success).toBe(false);
  });

  it('rejects a decimal the column would round, rather than storing a different number', () => {
    // height_cm is numeric(5, 1): 183.75 would land as 183.8.
    const form = completeForm();
    form.set('heightCm', '183.75');
    expect(settingsSchema.safeParse(readSettingsForm(form)).success).toBe(false);

    // bodyweight_kg is numeric(6, 2), so two places are fine there.
    const weight = completeForm();
    weight.set('bodyweightKg', '82.55');
    expect(settingsSchema.safeParse(readSettingsForm(weight)).success).toBe(true);
  });
});
