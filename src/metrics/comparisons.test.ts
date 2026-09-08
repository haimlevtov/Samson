/**
 * Tests for `src/metrics/comparisons.ts`.
 *
 * The properties are generated rather than enumerated because the claims are
 * about every total, not about five of them — and because the failure mode this
 * guards against is not a crash. A comparison that picks an object heavier than
 * the total, or reports a count of zero, renders a sentence that is simply
 * false, on the one line of the app whose whole job is to be believable.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compareTonnage } from './comparisons';
import type { ComparisonObject } from './types';

const object = (slug: string, massKg: number): ComparisonObject => ({
  slug,
  singular: `a ${slug}`,
  plural: `${slug}s`,
  massKg,
  sourceNote: 'fixture',
});

/** The shape of the shipped ladder: wide, ascending, spanning five orders. */
const LADDER: readonly ComparisonObject[] = [
  object('cat', 4.5),
  object('washing-machine', 70),
  object('piano', 220),
  object('horse', 500),
  object('car', 1200),
  object('elephant', 6000),
  object('bus', 12000),
  object('whale', 150000),
];

const LIGHTEST = 4.5;

describe('picking a comparison', () => {
  it('says nothing at all below the lightest object', () => {
    // Deliberately null rather than "about half a cat": a beginner three sets
    // into their first session is not owed a fraction of an animal.
    expect(compareTonnage(0, LADDER)).toBeNull();
    expect(compareTonnage(4.4, LADDER)).toBeNull();
    expect(compareTonnage(LIGHTEST, LADDER)?.object.slug).toBe('cat');
  });

  it('takes the heaviest object passed, not the closest fitting one', () => {
    /*
     * 13,000 kg is one bus, or 2,888 cats, or 2 elephants. Closest-fitting
     * would pick something else at almost every level; heaviest-passed is what
     * keeps the count small as the number grows.
     */
    const result = compareTonnage(13_000, LADDER);
    expect(result?.object.slug).toBe('bus');
    expect(result?.count).toBe(1);
  });

  it('counts whole objects only', () => {
    expect(compareTonnage(35_999, LADDER)?.count).toBe(2);
    expect(compareTonnage(36_000, LADDER)?.count).toBe(3);
  });

  it('is not fooled by the order rows arrive in', () => {
    // The reader sorts by mass, but nothing in the contract says it must, and a
    // function that depended on the ORDER BY would break the day somebody
    // removed it for looking redundant.
    const shuffled = [...LADDER].reverse();
    expect(compareTonnage(13_000, shuffled)?.object.slug).toBe('bus');
  });

  it('skips a row with an impossible mass rather than trusting it', () => {
    const broken = [...LADDER, object('glitch', 0), object('worse', -100)];
    expect(compareTonnage(13_000, broken)?.object.slug).toBe('bus');

    /*
     * And a mass that is not a number at all. This one was not theoretical:
     * the column shipped with `check (mass_kg > 0)`, and PostgreSQL orders NaN
     * ABOVE every non-NaN numeric so that it can be indexed — so
     * `'NaN'::numeric > 0` is true and the constraint admitted one. Tightened
     * to `> 0 and < 1e10` in migration 20260908100100; this guard stays as the
     * second gate.
     */
    const nonFinite = [...LADDER, { ...object('nan', 0), massKg: Number.NaN }];
    expect(compareTonnage(13_000, nonFinite)?.object.slug).toBe('bus');
  });

  it('has nothing to say when handed nothing to say it with', () => {
    expect(compareTonnage(13_000, [])).toBeNull();
  });

  it('refuses a total that is not a usable number', () => {
    expect(compareTonnage(Number.NaN, LADDER)).toBeNull();
    expect(compareTonnage(Number.POSITIVE_INFINITY, LADDER)).toBeNull();
    expect(compareTonnage(-1, LADDER)).toBeNull();
  });
});

describe('properties that must hold for every total', () => {
  const totals = fc.double({ min: 0, max: 50_000_000, noNaN: true });

  it('never picks an object heavier than the total', () => {
    fc.assert(
      fc.property(totals, (total) => {
        const result = compareTonnage(total, LADDER);
        if (result === null) return;
        expect(result.object.massKg).toBeLessThanOrEqual(total);
      })
    );
  });

  it('never reports a count below one', () => {
    // The claim the implementation makes instead of clamping: massKg <= total
    // is the filter, so the quotient cannot round under 1. If that reasoning is
    // ever wrong, it is wrong here.
    fc.assert(
      fc.property(totals, (total) => {
        const result = compareTonnage(total, LADDER);
        if (result === null) return;
        expect(result.count).toBeGreaterThanOrEqual(1);
      })
    );
  });

  it('never claims more mass than was lifted', () => {
    fc.assert(
      fc.property(totals, (total) => {
        const result = compareTonnage(total, LADDER);
        if (result === null) return;
        expect(result.count * result.object.massKg).toBeLessThanOrEqual(total);
      })
    );
  });

  it('returns null only below the lightest object', () => {
    // The other half of the above: a total at or past the lightest row must
    // always produce something, or a user crosses a threshold and the sentence
    // silently disappears.
    fc.assert(
      fc.property(totals, (total) => {
        expect(compareTonnage(total, LADDER) === null).toBe(total < LIGHTEST);
      })
    );
  });

  it('never moves down the ladder as the total grows', () => {
    fc.assert(
      fc.property(totals, fc.double({ min: 0, max: 1_000_000, noNaN: true }), (total, extra) => {
        const before = compareTonnage(total, LADDER);
        const after = compareTonnage(total + extra, LADDER);
        if (before === null) return;
        expect(after).not.toBeNull();
        expect(after!.object.massKg).toBeGreaterThanOrEqual(before.object.massKg);
      })
    );
  });
});
