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
 * consumes the result can share one definition. There is no second copy of
 * these bounds: 20260909120000_user_biometrics_bounds.sql holds the same
 * numbers as CHECK constraints, deliberately — a constraint cannot see a value
 * arriving by a path that skips the column, and code cannot see a row written
 * before it existed.
 *
 * AI-NOTE: changing a bound here means changing that migration in the same
 *          commit, and docs/specs/diet.md §1 with it.
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
 * WHY not the column's own ceiling: `numeric(6, 2)` tops out at 9,999.99, which
 * is a BMR near 162,000 kcal. The heaviest person ever recorded was 635 kg and
 * the tallest 272 cm, so these reject a slipped decimal point while admitting
 * anybody real.
 */
export const MAX_BODYWEIGHT_KG = 1000;
export const MAX_HEIGHT_CM = 300;

/** The oldest verified human lived to 122. */
export const EARLIEST_BIRTH_DATE = '1900-01-01';

/**
 * A decimal a person types into a number field: digits, optionally two places.
 *
 * WHY a pattern rather than `z.coerce.number()` — and this is the trap, not a
 * preference. `z.coerce.number()` maps `""` and `" "` to **0** and `"0x10"` to
 * **16**. Blank has to stay distinguishable from zero here, because absent is a
 * real state that produces a named refusal while zero is a validation failure;
 * a coercion that silently turns "I cleared this field" into "I weigh nothing"
 * would make the whole missing-biometric path unreachable.
 */
const DECIMAL_INPUT = /^\d{1,4}(?:\.\d{1,2})?$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date that exists, not merely one shaped like a date.
 *
 * FOUND IN TESTING: this was `Date.parse(\`${raw}T00:00:00Z\`)` with a comment
 * saying ISO parsing rejects impossible days. It does not — V8 rolls them over,
 * so `2026-02-31` parses happily as 3 March and `2026-13-01` as 1 January 2027.
 * A birth date silently moved by three days is the kind of wrong nothing
 * downstream can detect, and it would land on the age comparison that decides
 * whether somebody is shown a calorie target at all.
 *
 * The round trip is the check: build the date from the parts and require the
 * parts to survive it.
 */
function isRealDate(iso: string): boolean {
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
export function measurementField(max: number, unit: string) {
  return z
    .string()
    .trim()
    .transform((raw) => (raw === '' ? null : raw))
    .refine((raw) => raw === null || DECIMAL_INPUT.test(raw), `Give a number in ${unit}.`)
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
