import { describe, expect, it } from 'vitest';
import { distinctName } from './naming';
import { TEMPLATE_NAME_MAX } from './schema';

describe('distinctName', () => {
  const base = 'Week 1 · Day 1 — Upper';

  it('keeps a name nobody has', () => {
    expect(distinctName(base, ['Day A', 'Day B'])).toBe(base);
  });

  it('counts from two for the second copy, and on from there', () => {
    // The rework plan's PR 7 decision: a second import is allowed, and the
    // Workout tab, which lists templates by name alone, can tell them apart.
    expect(distinctName(base, [base])).toBe(`${base} (2)`);
    expect(distinctName(base, [base, `${base} (2)`])).toBe(`${base} (3)`);
  });

  it('takes the first free counter, not the next after the highest', () => {
    expect(distinctName(base, [base, `${base} (3)`])).toBe(`${base} (2)`);
  });

  it('stays inside the name bound, cutting the base rather than the counter', () => {
    const long = 'x'.repeat(TEMPLATE_NAME_MAX);
    const named = distinctName(long, [long]);

    expect(named.length).toBeLessThanOrEqual(TEMPLATE_NAME_MAX);
    expect(named.endsWith('… (2)')).toBe(true);
  });

  it('ignores surrounding whitespace on either side', () => {
    expect(distinctName(`  ${base} `, [`${base}  `])).toBe(`${base} (2)`);
  });
});
