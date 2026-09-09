/**
 * The four values the diet advisor needs, and the bounds they are accepted in.
 *
 * Contract: docs/specs/diet.md §1. Design: docs/adr/0024-diet-advisor.md.
 *
 * INVARIANT: kilograms and centimetres are canonical — CLAUDE.md #8. Nothing
 *            here converts, because nothing in the app displays imperial yet;
 *            app/settings/page.tsx says so on the page itself.
 *
 * Pure, so both the server action that validates a form and the engine that
 * consumes the result can share one definition.
 *
 * The same numbers are CHECK constraints in
 * 20260909120000_user_biometrics_bounds.sql, and that duplication is the point:
 * two independent gates. A constraint cannot see a value arriving by a path
 * that skips the column, and code cannot see a row written before it existed.
 * PostgREST is reachable with any user's own token, so the column is not
 * theoretical cover.
 *
 * AI-NOTE: these numbers appear in FOUR places and changing one means changing
 *          all four in the same commit —
 *            1. here,
 *            2. 20260909120000_user_biometrics_bounds.sql,
 *            3. docs/specs/diet.md §1,
 *            4. docs/FRAMING.md's "Numbers invented outright" table.
 *          tests/db/biometrics.test.ts imports from here rather than repeating
 *          them, so it moves on its own. The two GATES are defence in depth only
 *          while they agree: where they disagree the wider one is decoration and
 *          the narrower one produces an error the user cannot act on.
 */
import { z } from 'zod';

export const SEXES = ['male', 'female', 'unspecified'] as const;
export type Sex = (typeof SEXES)[number];

export function isSex(value: string | null): value is Sex {
  return value !== null && (SEXES as readonly string[]).includes(value);
}

/**
 * Past any real value, and still tight enough to reject a typo.
 *
 * WHY not the columns' own ceilings: `numeric(6, 2)` tops out at 9,999.99 kg and
 * `numeric(5, 1)` at 9,999.9 cm, and the two together are a BMR near 162,000
 * kcal — the weight alone is around 101,000, which is no better. The heaviest
 * person ever recorded was 635 kg and the tallest 272 cm, so these reject a
 * slipped decimal point while admitting anybody real.
 */
export const MAX_BODYWEIGHT_KG = 1000;
export const MAX_HEIGHT_CM = 300;

/**
 * The DECLARED SCALE of each column, and it is not a formatting detail.
 *
 * FOUND IN REVIEW: PostgreSQL rounds a numeric to its declared scale BEFORE the
 * CHECK runs. `height_cm` is `numeric(5, 1)`, so `299.99` — which passes both
 * app gates — is stored as `300.0` and then violates `height_cm < 300`. The
 * user gets "could not save that" on a value the form accepted, for the whole
 * window 299.95 to 299.99, and no amount of retrying fixes it. The quiet cousin
 * is worse to explain: `170.55` is accepted and silently becomes `170.6`.
 *
 * So the grammar below admits exactly what the column can hold without
 * rounding. The two gates then agree instead of merely both existing.
 *
 * AI-NOTE: these track the column types in 20260824150139_users.sql. Changing a
 *          column's scale means changing the number here in the same commit.
 */
export const BODYWEIGHT_SCALE = 2;
export const HEIGHT_SCALE = 1;

/** The oldest verified human lived to 122. */
export const EARLIEST_BIRTH_DATE = '1900-01-01';

/**
 * A decimal a person types, at a scale the column stores without rounding.
 *
 * WHY a pattern rather than `z.coerce.number()` — and this is the trap, not a
 * preference. `z.coerce.number()` maps `""` and `" "` to **0** and `"0x10"` to
 * **16**. Blank has to stay distinguishable from zero here, because absent is a
 * real state that produces a named refusal while zero is a validation failure;
 * a coercion that silently turns "I cleared this field" into "I weigh nothing"
 * would make the whole missing-biometric path unreachable.
 *
 * `\d` in a non-unicode regex is `[0-9]` only, so Eastern Arabic and fullwidth
 * digits are rejected here even though `Number()` would happily read them.
 */
function decimalInput(scale: number): RegExp {
  return new RegExp(`^\\d{1,4}(?:\\.\\d{1,${scale}})?$`);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date that exists, not merely one shaped like a date.
 *
 * FOUND IN TESTING: this was `Date.parse(\`${raw}T00:00:00Z\`)` with a comment
 * saying ISO parsing rejects impossible days. It does not. `2026-02-31` parses
 * happily as **3 March** — a birth date silently moved by three days, which is
 * the kind of wrong nothing downstream can detect, landing on the age
 * comparison that decides whether somebody is shown a calorie target at all.
 * (An out-of-range MONTH like `2026-13-01` does give NaN, so the old check
 * caught half of this and the half it missed was the quiet one.)
 *
 * The round trip is the check: build the date from the parts and require the
 * parts to survive it.
 */
export function isRealDate(iso: string): boolean {
  /*
   * The SHAPE is checked here rather than only by the caller, because this is
   * exported and `src/diet/energy.ts` calls it on its own. Without it `1995-7-2`
   * round-trips happily — the parts survive, they are simply not zero-padded —
   * and `ageOn` slices fixed offsets out of the string, so an unpadded date
   * silently reads the wrong year.
   */
  if (!ISO_DATE.test(iso)) return false;

  const [year, month, day] = iso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;

  const built = new Date(Date.UTC(year, month - 1, day));
  return (
    built.getUTCFullYear() === year &&
    built.getUTCMonth() === month - 1 &&
    built.getUTCDate() === day
  );
}

/**
 * A blank-or-number field: `null` when cleared, a bounded number otherwise.
 *
 * `0` is rejected rather than stored. It fails the column's CHECK anyway, and
 * failing here produces a sentence naming the field instead of a database error
 * naming a constraint.
 */
export function measurementField(max: number, unit: string, scale: number) {
  const pattern = decimalInput(scale);
  const places = scale === 1 ? 'one decimal place' : `${scale} decimal places`;

  return z
    .string()
    .trim()
    .transform((raw) => (raw === '' ? null : raw))
    .refine(
      (raw) => raw === null || pattern.test(raw),
      // The scale is in the message because the alternative is a rejection the
      // user cannot act on: "182.55" looks like a number and is not one here.
      { error: `Give a number in ${unit}, to at most ${places}.`, abort: true }
    )
    .transform((raw) => (raw === null ? null : Number(raw)))
    .refine(
      (value) => value === null || (Number.isFinite(value) && value > 0 && value < max),
      `That has to be between 0 and ${max} ${unit}, or blank.`
    );
}

/**
 * A blank-or-date field, bounded below only.
 *
 * WHY the future is NOT checked here: "in the future" depends on whose today,
 * and CLAUDE.md #9 says that is the user's local date rather than the server's.
 * The caller compares against `localDateFor(timezone)` — see
 * `isFutureBirthDate` — because only the caller knows the timezone, and in the
 * settings form the user may be changing it in the same submit.
 */
export function birthDateField() {
  return z
    .string()
    .trim()
    .transform((raw) => (raw === '' ? null : raw))
    .refine((raw) => raw === null || ISO_DATE.test(raw), 'Give a date.')
    .refine(
      (raw) => raw === null || (isRealDate(raw) && raw >= EARLIEST_BIRTH_DATE),
      `That has to be a real date after ${EARLIEST_BIRTH_DATE}, or blank.`
    );
}

/** ISO dates compare correctly as strings, which is why both are `LocalDate`. */
export function isFutureBirthDate(birthDate: string, today: string): boolean {
  return birthDate > today;
}
