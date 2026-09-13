import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareDates,
  daysBetween,
  eachDay,
  isLocalDate,
  isWithin,
  isoWeek,
  startOfWeek,
} from './dates';

describe('isLocalDate', () => {
  it('accepts real calendar dates', () => {
    expect(isLocalDate('2026-08-24')).toBe(true);
    expect(isLocalDate('2024-02-29')).toBe(true); // leap year
  });

  it('rejects malformed and impossible dates', () => {
    for (const bad of ['2026-8-24', '24-08-2026', '2026-02-30', '2026-13-01', 'today', '']) {
      expect(isLocalDate(bad), bad).toBe(false);
    }
    // Not a leap year: Date.UTC would roll this to March 1 without the check.
    expect(isLocalDate('2026-02-29')).toBe(false);
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('crosses a leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('survives a spring-forward DST boundary', () => {
    // WHY: this is the case a local Date constructor gets wrong. Europe springs
    //      forward on 2026-03-29; treating the label as UTC keeps it exact.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(daysBetween('2026-03-30', '2026-03-28')).toBe(2);
  });

  it('round-trips', () => {
    expect(addDays(addDays('2026-08-24', 137), -137)).toBe('2026-08-24');
  });

  it('throws on a non-date rather than returning nonsense', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });
});

describe('daysBetween and compareDates', () => {
  it('is signed and consistent', () => {
    expect(daysBetween('2026-08-24', '2026-08-17')).toBe(7);
    expect(daysBetween('2026-08-17', '2026-08-24')).toBe(-7);
    expect(daysBetween('2026-08-24', '2026-08-24')).toBe(0);
    expect(compareDates('2026-01-01', '2026-01-02')).toBeLessThan(0);
  });

  it('spans a full year including a leap day', () => {
    expect(daysBetween('2025-01-01', '2024-01-01')).toBe(366);
  });
});

describe('isWithin', () => {
  it('includes both ends', () => {
    expect(isWithin('2026-08-18', '2026-08-18', '2026-08-24')).toBe(true);
    expect(isWithin('2026-08-24', '2026-08-18', '2026-08-24')).toBe(true);
    expect(isWithin('2026-08-17', '2026-08-18', '2026-08-24')).toBe(false);
    expect(isWithin('2026-08-25', '2026-08-18', '2026-08-24')).toBe(false);
  });
});

describe('startOfWeek', () => {
  it('returns the Monday on or before the date', () => {
    // 2026-08-24 is a Monday.
    expect(startOfWeek('2026-08-24')).toBe('2026-08-24');
    expect(startOfWeek('2026-08-25')).toBe('2026-08-24');
    expect(startOfWeek('2026-08-30')).toBe('2026-08-24'); // Sunday
    expect(startOfWeek('2026-08-31')).toBe('2026-08-31'); // next Monday
  });

  it('is idempotent', () => {
    for (const d of ['2026-08-24', '2026-08-27', '2026-01-01', '2024-02-29']) {
      expect(startOfWeek(startOfWeek(d))).toBe(startOfWeek(d));
    }
  });

  it('groups all seven days of a week together', () => {
    const week = eachDay('2026-08-24', '2026-08-30').map(startOfWeek);
    expect(new Set(week).size).toBe(1);
  });
});

describe('eachDay', () => {
  it('is inclusive and ascending', () => {
    expect(eachDay('2026-08-24', '2026-08-26')).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
  });

  it('returns one day for a single-day range and none for a reversed one', () => {
    expect(eachDay('2026-08-24', '2026-08-24')).toEqual(['2026-08-24']);
    expect(eachDay('2026-08-24', '2026-08-23')).toEqual([]);
  });

  it('produces the expected length across a month boundary', () => {
    expect(eachDay('2026-01-28', '2026-02-03')).toHaveLength(7);
  });
});

describe('isoWeek', () => {
  it('reads the week the handoff was drawn in', () => {
    // Hub's mock says "WEEK 37" beside 12/09/2026.
    expect(isoWeek('2026-09-12')).toBe(37);
    expect(isoWeek('2026-09-13')).toBe(37);
    expect(isoWeek('2026-09-14')).toBe(38);
  });

  it('gives a week to the year that holds its Thursday', () => {
    expect(isoWeek('2026-01-01')).toBe(1); // a Thursday
    expect(isoWeek('2027-01-01')).toBe(53); // a Friday, still 2026's last week
    expect(isoWeek('2024-12-30')).toBe(1); // a Monday, already 2025's first
    expect(isoWeek('2021-01-03')).toBe(53); // a Sunday, still 2020's
  });

  it('is the same number for every day from Monday to Sunday', () => {
    const monday = '2026-03-23';
    const weeks = eachDay(monday, addDays(monday, 6)).map(isoWeek);
    expect(new Set(weeks).size).toBe(1);
  });

  it('never leaves 1 to 53 across a decade', () => {
    for (const day of eachDay('2020-01-01', '2030-12-31')) {
      const week = isoWeek(day);
      expect(week).toBeGreaterThanOrEqual(1);
      expect(week).toBeLessThanOrEqual(53);
    }
  });
});
