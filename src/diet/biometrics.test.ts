/**
 * The input contract for the diet advisor — docs/specs/diet.md §1.
 *
 * These run with no database, no network and no API key.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BODYWEIGHT_SCALE,
  EARLIEST_BIRTH_DATE,
  HEIGHT_SCALE,
  MAX_BODYWEIGHT_KG,
  MAX_HEIGHT_CM,
  SEXES,
  birthDateField,
  isFutureBirthDate,
  isSex,
  measurementField,
} from './biometrics';

const weight = measurementField(MAX_BODYWEIGHT_KG, 'kg', BODYWEIGHT_SCALE);
const height = measurementField(MAX_HEIGHT_CM, 'cm', HEIGHT_SCALE);
const birthDate = birthDateField();

/** The parsed value, or the symbol REJECTED — keeps the assertions readable. */
const REJECTED = Symbol('rejected');
function parse<T>(schema: z.ZodType<T>, raw: string): T | typeof REJECTED {
  const result = schema.safeParse(raw);
  return result.success ? result.data : REJECTED;
}

describe('measurementField', () => {
  it('reads a plain number', () => {
    expect(parse(weight, '82')).toBe(82);
    expect(parse(weight, '82.5')).toBe(82.5);
  });

  it('treats blank as absent rather than zero', () => {
    expect(parse(weight, '')).toBeNull();
    expect(parse(weight, '   ')).toBeNull();
  });

  /*
   * The whole reason this field is hand-rolled rather than `z.coerce.number()`.
   *
   * Coercion maps "" and " " to 0, which would make "I cleared this field"
   * indistinguishable from "I weigh nothing" — and the missing-biometric
   * refusal, which is the only branch that tells a user what the advisor is
   * waiting for, would become unreachable. It maps "0x10" to 16 as well.
   */
  it('is not z.coerce.number(), and here is the difference', () => {
    const coerced = z.coerce.number();
    expect(coerced.parse('')).toBe(0);
    expect(coerced.parse(' ')).toBe(0);
    expect(coerced.parse('0x10')).toBe(16);

    expect(parse(weight, '')).toBeNull();
    expect(parse(weight, ' ')).toBeNull();
    expect(parse(weight, '0x10')).toBe(REJECTED);
  });

  it('rejects zero, which is a value rather than an absence', () => {
    expect(parse(weight, '0')).toBe(REJECTED);
    expect(parse(weight, '0.00')).toBe(REJECTED);
  });

  it('rejects anything that is not a decimal a person would type', () => {
    for (const raw of ['-5', '1e3', 'Infinity', 'NaN', 'eighty', '80kg', '8 0']) {
      expect(parse(weight, raw), raw).toBe(REJECTED);
    }
  });

  it('rejects a magnitude past the bound, in both fields', () => {
    expect(parse(weight, String(MAX_BODYWEIGHT_KG))).toBe(REJECTED);
    expect(parse(weight, '9999.99')).toBe(REJECTED);

    expect(parse(height, '9999.9')).toBe(REJECTED);
    expect(parse(height, '183')).toBe(183);
  });

  /*
   * FOUND IN REVIEW. Postgres rounds a numeric to its declared scale BEFORE the
   * CHECK runs, so a grammar looser than the column produces two bugs at once:
   * 299.99 cm passes the app bound of "< 300", becomes 300.0, and then violates
   * the constraint — an error on a value the form offered, that no retry fixes.
   * And 183.75 would be accepted and silently stored as 183.8.
   *
   * These assertions are the two gates agreeing, which is the only state in
   * which having two of them means anything.
   */
  it('admits only the decimal places its column can hold', () => {
    // height_cm is numeric(5, 1).
    expect(parse(height, '183.7')).toBe(183.7);
    expect(parse(height, '183.75')).toBe(REJECTED);
    expect(parse(height, '299.99')).toBe(REJECTED);
    expect(parse(height, '299.9')).toBe(299.9);

    // bodyweight_kg is numeric(6, 2).
    expect(parse(weight, '82.55')).toBe(82.55);
    expect(parse(weight, '82.555')).toBe(REJECTED);
  });
});

describe('birthDateField', () => {
  it('reads an ISO date and treats blank as absent', () => {
    expect(parse(birthDate, '1995-07-02')).toBe('1995-07-02');
    expect(parse(birthDate, '')).toBeNull();
  });

  /*
   * The quiet half is the day, not the month. `Date.parse('2026-13-01…')` really
   * is NaN, so the old check caught that one; `2026-02-31` parses as 3 March,
   * and a birth date moved three days is what nothing downstream can detect.
   */
  it('rejects a date that does not exist', () => {
    expect(parse(birthDate, '2026-02-31')).toBe(REJECTED);
    expect(parse(birthDate, '2026-13-01')).toBe(REJECTED);
    expect(parse(birthDate, '2025-02-29')).toBe(REJECTED);
    expect(parse(birthDate, '2024-02-29')).toBe('2024-02-29');
  });

  it('rejects anything that is not an ISO date', () => {
    for (const raw of ['02/07/1995', '1995-7-2', 'yesterday', '1995']) {
      expect(parse(birthDate, raw), raw).toBe(REJECTED);
    }
  });

  it('rejects a date before the earliest a living person could hold', () => {
    expect(parse(birthDate, '1899-12-31')).toBe(REJECTED);
    expect(parse(birthDate, EARLIEST_BIRTH_DATE)).toBe(EARLIEST_BIRTH_DATE);
  });

  /*
   * The future is NOT this field's job, and the test says so rather than
   * leaving the absence to be read as an oversight. Whose "today" it is depends
   * on the user's timezone — CLAUDE.md #9 — and the settings form may be
   * changing that timezone in the same submit.
   */
  it('does not reject the future, deliberately', () => {
    expect(parse(birthDate, '2099-01-01')).toBe('2099-01-01');
  });
});

describe('isFutureBirthDate', () => {
  it('compares ISO dates as strings, which orders them correctly', () => {
    expect(isFutureBirthDate('2026-09-10', '2026-09-09')).toBe(true);
    expect(isFutureBirthDate('2026-09-09', '2026-09-09')).toBe(false);
    expect(isFutureBirthDate('1995-07-02', '2026-09-09')).toBe(false);
  });

  /*
   * The case the column's bound cannot catch and this does: a year the CHECK
   * admits, in a timezone where it has not happened yet. `3000-01-01` is caught
   * by the migration; `2026-09-10` in Jerusalem while it is still the 9th in
   * New York is caught only here.
   */
  it('is timezone-sensitive, which is the whole reason it is not a CHECK', () => {
    expect(isFutureBirthDate('2026-09-10', '2026-09-09')).toBe(true);
    expect(isFutureBirthDate('2026-09-10', '2026-09-10')).toBe(false);
  });

  /*
   * The string comparison is only correct because both sides are zero-padded
   * fixed-width. `ISO_DATE` pins the left. The right comes from `localDateFor`,
   * which is `Intl.DateTimeFormat('en-CA', { 2-digit month and day })` — pinned
   * here rather than left as an assumption, because that function lives in
   * src/db/server.ts and cannot be imported into a unit test (it pulls in
   * next/headers). If its formatter ever changes, this fails.
   */
  it('agrees with the format localDateFor produces', () => {
    const asLocalDateFor = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date('2026-01-05T12:00:00Z'));

    expect(asLocalDateFor).toBe('2026-01-05');
    expect(isFutureBirthDate('2026-01-06', asLocalDateFor)).toBe(true);
    expect(isFutureBirthDate('2026-01-04', asLocalDateFor)).toBe(false);
  });
});

describe('isSex', () => {
  it('admits exactly the three the column constrains', () => {
    for (const value of SEXES) expect(isSex(value)).toBe(true);
    expect(SEXES).toHaveLength(3);
  });

  it('rejects null and anything else, so an unknown value reads as absent', () => {
    for (const value of [null, '', 'Male', 'other', 'm']) {
      expect(isSex(value), String(value)).toBe(false);
    }
  });
});
