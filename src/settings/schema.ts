/**
 * What the settings form is allowed to contain, and how a submission is read.
 *
 * INVARIANT: the Zod schema is the single source of truth and the TS type is
 *            derived from it — CLAUDE.md § Conventions.
 *
 * WHY this is a module of its own rather than living in the server action:
 * `app/settings/actions.ts` carries `'use server'`, and such a module may only
 * export async functions — so nothing in it can be imported by a test. The
 * class of bug below is only catchable if the schema and the reader can be put
 * side by side, which means they have to be exported from somewhere that is not
 * an action file.
 */
import { z } from 'zod';

import { MAX_DISPLAY_NAME } from '../db/leaderboard';
import {
  BODYWEIGHT_SCALE,
  HEIGHT_SCALE,
  MAX_BODYWEIGHT_KG,
  MAX_HEIGHT_CM,
  SEXES,
  birthDateField,
  measurementField,
} from '../diet/biometrics';
import { HUMOR_LEVELS } from '../persona/schema';
import { THEMES } from '../ui/theme';

/**
 * A timezone the platform can actually resolve.
 *
 * WHY validated here rather than in the database: CLAUDE.md #9 makes every
 * calendar-triggered achievement evaluate against this string, and
 * `users.timezone` records that Postgres cannot check it — the IANA lookup is
 * not immutable. So the app boundary is the only place it can be checked, and
 * a bad value here silently moves someone's local date.
 */
export function isKnownTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const settingsSchema = z.object({
  // Empty means "no name", not an empty name — the headers fall back to email.
  displayName: z
    .string()
    .trim()
    .max(MAX_DISPLAY_NAME, `Keep it to ${MAX_DISPLAY_NAME} characters.`)
    .transform((value) => (value === '' ? null : value)),
  timezone: z
    .string()
    .trim()
    .refine(isKnownTimezone, 'That is not a timezone this device recognises.'),
  humorMaxLevel: z.enum(HUMOR_LEVELS),
  theme: z.enum(THEMES),
  /*
   * A plain boolean, because the absent-means-false translation happens at the
   * FormData boundary in `readSettingsForm`, beside the other defaults.
   *
   * WHY it is worth a comment: an unchecked checkbox sends NOTHING at all, so
   * the value here is derived from a presence check rather than read. FOUND IN
   * TESTING — this field was in the schema and missing from the parse object,
   * which made it permanently undefined and failed EVERY settings save, not
   * only the ones touching the leaderboard.
   *
   * ADR 0016 §4: the stored default is visible, and this is the way out.
   */
  leaderboardOptOut: z.boolean(),

  /*
   * The four the diet advisor needs — ADR 0024, docs/specs/diet.md §1.
   *
   * Every one of them may be cleared, and blank means NULL rather than zero:
   * absent produces a named refusal in src/diet/, while a stored 0 would fail
   * the column's CHECK and read as a person who weighs nothing. The parsing
   * that keeps those apart is in `measurementField`, along with the reason
   * `z.coerce.number()` cannot be used here.
   */
  bodyweightKg: measurementField(MAX_BODYWEIGHT_KG, 'kg', BODYWEIGHT_SCALE),
  heightCm: measurementField(MAX_HEIGHT_CM, 'cm', HEIGHT_SCALE),
  /*
   * Bounded below and shape-checked only. "Not in the future" is the caller's
   * job: it depends on the user's local date (CLAUDE.md #9), and in this form
   * the user may be changing their timezone in the same submit — so the schema
   * cannot know which today to ask about.
   */
  birthDate: birthDateField(),
  /*
   * Blank is "not set"; the three values are the ones the column constrains.
   * `unspecified` is a real choice with a real behaviour — ADR 0024 §3 — and is
   * not the same as leaving this alone.
   *
   * `z.enum(...).nullable()` behind a preprocess rather than a string with a
   * refine and a cast: the enum is the source of truth and the type falls out of
   * it, which is the convention `humorMaxLevel` and `theme` above already
   * follow. The earlier version re-implemented `isSex` inline and then asserted
   * the type back with `as`, which is the one thing that would still compile if
   * the two lists drifted apart.
   */
  sex: z.preprocess(
    (raw) => (typeof raw === 'string' && raw.trim() === '' ? null : raw),
    z.enum(SEXES).nullable()
  ),
});

export type SettingsInput = z.infer<typeof settingsSchema>;

/**
 * One submission, as the shape the schema parses.
 *
 * INVARIANT: every key in `settingsSchema` appears here, and nothing else does.
 *            `tests/unit/settings-schema.test.ts` asserts it in both directions.
 *
 * WHY that test exists: a field present in the schema and absent here is
 * permanently `undefined`, which fails EVERY save rather than only the one that
 * touches it — and typecheck cannot see it, because the object handed to
 * `safeParse` is an untyped literal. That has happened once already, on
 * `leaderboardOptOut`. This is the class, not the instance.
 */
export function readSettingsForm(formData: FormData): Record<keyof SettingsInput, unknown> {
  return {
    displayName: field(formData, 'displayName'),
    timezone: field(formData, 'timezone'),
    humorMaxLevel: field(formData, 'humorMaxLevel'),
    theme: field(formData, 'theme'),
    /*
     * The one field with presence semantics, and the only one exempt from the
     * rule below: an unticked checkbox sends NOTHING AT ALL, so absent is the
     * value rather than a missing value.
     */
    leaderboardOptOut: formData.get('leaderboardOptOut') === 'on',
    bodyweightKg: field(formData, 'bodyweightKg'),
    heightCm: field(formData, 'heightCm'),
    birthDate: field(formData, 'birthDate'),
    sex: field(formData, 'sex'),
  };
}

/**
 * A field the form sent, or `undefined` if it sent no such field at all.
 *
 * FOUND IN REVIEW, and this used to be `?? ''`. The four biometrics treat blank
 * as "clear this", so a submission that simply OMITS them was indistinguishable
 * from one that cleared them: a POST carrying only the four appearance fields
 * succeeded and **erased the user's whole health profile**, silently and with a
 * "Saved" on screen. Every other field fails loudly when absent — an empty
 * string is not a valid timezone or theme — so the health fields were the only
 * ones where absence was destructive rather than noisy.
 *
 * `undefined` fails `z.string()` with a message naming the field, so an
 * incomplete submission is now rejected rather than applied. The real form
 * always sends all nine: a blank text input posts `''`, and a `<select>` posts
 * its current value.
 *
 * AI-NOTE: if a second surface ever writes one of these — a "log today's
 *          weight" control on the diet block, say — it must NOT post a subset
 *          to this action. Give it its own action that updates one column.
 */
function field(formData: FormData, name: keyof SettingsInput): unknown {
  return formData.has(name) ? formData.get(name) : undefined;
}
