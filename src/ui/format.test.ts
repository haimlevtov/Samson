import { describe, expect, it } from 'vitest';
import { displayDate, displayShortDate } from './format';

describe('displayDate', () => {
  it('renders DD/MM/YYYY', () => {
    expect(displayDate('2026-08-25')).toBe('25/08/2026');
    expect(displayDate('2026-01-01')).toBe('01/01/2026');
    expect(displayDate('2024-02-29')).toBe('29/02/2024');
  });

  it('keeps the leading zeros that make the format unambiguous', () => {
    expect(displayDate('2026-03-07')).toBe('07/03/2026');
  });

  it('does not shift the day across a timezone', () => {
    // WHY this test exists: `new Date('2026-08-25')` is midnight UTC, which
    // formats as 24/08 for anyone west of Greenwich. The stored value is
    // already the user's local date — a label, not an instant.
    const original = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        expect(displayDate('2026-08-25'), tz).toBe('25/08/2026');
      }
    } finally {
      process.env.TZ = original;
    }
  });

  it('passes through anything that is not a date rather than inventing one', () => {
    expect(displayDate('not a date')).toBe('not a date');
    expect(displayDate('2026-8-5')).toBe('2026-8-5');
  });

  it('renders an em dash for a missing value', () => {
    expect(displayDate(null)).toBe('—');
    expect(displayDate(undefined)).toBe('—');
    expect(displayDate('')).toBe('—');
  });
});

describe('displayShortDate', () => {
  it('drops the year', () => {
    expect(displayShortDate('2026-08-25')).toBe('25/08');
    expect(displayShortDate('2026-01-01')).toBe('01/01');
  });

  it('handles the same edge cases as displayDate', () => {
    expect(displayShortDate(null)).toBe('—');
    expect(displayShortDate('nope')).toBe('nope');
  });
});
