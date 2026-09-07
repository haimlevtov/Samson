/**
 * Tests for `src/gamification/level.ts`, written from
 * `docs/specs/xp-and-challenges.md`.
 *
 * The properties are generated rather than enumerated, for the same reason the
 * XP ceiling is: the claims are about every input, not about five of them. The
 * one that matters most for the interface is `agreement` — a bar and the label
 * beside it must come from the same computation, and nothing about a wrong
 * progress bar looks wrong until someone does the subtraction by hand.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { LEVEL_BASE_XP, LEVEL_GROWTH, levelForXp, levelProgress, xpForLevel } from './level';
import { WEEKLY_XP_CEILING } from './xp';

/** Well past anything the app produces, so the walk is exercised properly. */
const xpArb = fc.integer({ min: 0, max: 500_000 });

describe('the curve in the spec', () => {
  it('matches the worked table', () => {
    // Computed, not copied: these are the numbers the spec prints, and if the
    // implementation drifts from them one of the two documents is wrong.
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(300);
    expect(xpForLevel(3)).toBe(675);
    expect(xpForLevel(4)).toBe(1_144);
    expect(xpForLevel(5)).toBe(1_730);
    expect(xpForLevel(10)).toBe(7_741);
  });

  it('starts everyone at level 1, including a brand new account', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelProgress(0)).toEqual({ level: 1, intoLevel: 0, span: 300, toNext: 300 });
  });

  it('lets a strong first week reach level 2, which is the point', () => {
    // A perfect week earns 395 and level 2 costs 300. The reward has to arrive
    // while somebody is still deciding whether to come back.
    expect(LEVEL_BASE_XP).toBeLessThan(395);
    expect(levelForXp(395)).toBe(2);
  });

  /*
   * The anti-farming guarantee, and it is the ceiling rather than the cost of
   * level 2 — which is what an earlier version of this file asserted, wrongly.
   * Generated across the whole range because the worst case is not at zero: it
   * is 175 XP in, where a capped week straddles two boundaries.
   */
  it('cannot be farmed: no single week produces more than two level-ups', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60_000 }), (xp) => {
        const jump = levelForXp(xp + WEEKLY_XP_CEILING) - levelForXp(xp);
        expect(jump).toBeLessThanOrEqual(2);
      }),
      { numRuns: 5_000 }
    );
  });

  it('grows, or the number stops meaning anything', () => {
    expect(LEVEL_GROWTH).toBeGreaterThan(1);
    for (let n = 1; n < 20; n++) {
      const step = xpForLevel(n + 1) - xpForLevel(n);
      const nextStep = xpForLevel(n + 2) - xpForLevel(n + 1);
      expect(nextStep).toBeGreaterThanOrEqual(step);
    }
  });
});

describe('properties', () => {
  it('never returns a level below 1', () => {
    fc.assert(
      fc.property(xpArb, (xp) => {
        expect(levelForXp(xp)).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 5_000 }
    );
  });

  it('is monotonic in XP', () => {
    fc.assert(
      fc.property(xpArb, fc.integer({ min: 0, max: 50_000 }), (xp, more) => {
        expect(levelForXp(xp + more)).toBeGreaterThanOrEqual(levelForXp(xp));
      }),
      { numRuns: 5_000 }
    );
  });

  it('never reports a negative or zero remainder', () => {
    fc.assert(
      fc.property(xpArb, (xp) => {
        const p = levelProgress(xp);
        expect(p.intoLevel).toBeGreaterThanOrEqual(0);
        expect(p.toNext).toBeGreaterThan(0);
        expect(p.span).toBeGreaterThan(0);
      }),
      { numRuns: 5_000 }
    );
  });

  /*
   * The interface property. A caller printing these fields cannot draw a bar
   * that contradicts its own label, because the bar and the label are the same
   * three numbers.
   */
  it('agrees with itself: intoLevel + toNext === span', () => {
    fc.assert(
      fc.property(xpArb, (xp) => {
        const p = levelProgress(xp);
        expect(p.intoLevel + p.toNext).toBe(p.span);
      }),
      { numRuns: 5_000 }
    );
  });

  it('agrees with levelForXp: earning exactly toNext levels you up', () => {
    fc.assert(
      fc.property(xpArb, (xp) => {
        const p = levelProgress(xp);
        expect(levelForXp(xp + p.toNext)).toBe(p.level + 1);
        // And one XP short does not.
        expect(levelForXp(xp + p.toNext - 1)).toBe(p.level);
      }),
      { numRuns: 5_000 }
    );
  });

  it('round-trips through xpForLevel at every boundary', () => {
    // The property that only holds because each step is rounded BEFORE it is
    // summed. Rounding a closed-form geometric sum instead breaks this by a few
    // XP around level 10, which is exactly where real users are.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), (level) => {
        expect(levelForXp(xpForLevel(level))).toBe(level);
        if (level > 1) {
          expect(levelForXp(xpForLevel(level) - 1)).toBe(level - 1);
        }
      }),
      { numRuns: 2_000 }
    );
  });

  it('puts a level boundary exactly where progress resets', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (level) => {
        expect(levelProgress(xpForLevel(level)).intoLevel).toBe(0);
      }),
      { numRuns: 1_000 }
    );
  });
});

describe('inputs that should not happen', () => {
  it('treats a negative total as zero rather than throwing', () => {
    // Unreachable — xp_events.amount is non-negative by check constraint — and
    // a progress bar is not where anyone should learn that it happened.
    expect(levelForXp(-1)).toBe(1);
    expect(levelProgress(-5_000).level).toBe(1);
  });

  it('treats a non-finite total as zero', () => {
    expect(levelForXp(Number.NaN)).toBe(1);
    expect(levelForXp(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('ignores a fractional total rather than half-counting it', () => {
    expect(levelForXp(299.9)).toBe(1);
    expect(levelForXp(300.9)).toBe(2);
  });
});
