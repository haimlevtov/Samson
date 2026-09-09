/**
 * The arithmetic behind ADR 0022, with the measured case as the first fixture.
 */
import { describe, expect, it } from 'vitest';
import { computeHintShift, EDGE_GUTTER } from './hint-position';

const PHONE = 375;

describe('computeHintShift', () => {
  it('moves nothing when the popover already fits', () => {
    // WHY exactly zero rather than "something small": the shift is written to a
    // custom property the stylesheet reads, so a non-zero answer here would
    // move every bubble on the page that never had a problem.
    expect(computeHintShift({ left: 20, right: 280 }, PHONE)).toBe(0);
  });

  it('pulls back the case that was actually measured', () => {
    /*
     * /profile at 375px, the "Adherence" hint: rect left=158 right=418 against a
     * clientWidth of 375, and `documentElement.scrollWidth` read 418. The bubble
     * has to come back far enough to clear the right edge and the gutter.
     */
    const shift = computeHintShift({ left: 158, right: 418 }, PHONE);
    expect(shift).toBe(-(418 - (PHONE - EDGE_GUTTER)));
    expect(418 + shift).toBe(PHONE - EDGE_GUTTER);
  });

  it('leaves the gutter rather than landing flush on the edge', () => {
    const shift = computeHintShift({ left: 100, right: 375 }, PHONE);
    expect(375 + shift).toBe(PHONE - EDGE_GUTTER);
  });

  it('prefers the left edge when a popover cannot satisfy both', () => {
    /*
     * The centred rule at min-width: 760px translates the bubble left by half
     * its own width, so a wide one near the left of the viewport reports a
     * NEGATIVE left. Pushing it right is the correct answer even though it
     * leaves the right edge overhanging: text off the left is unreadable, text
     * off the right is reachable by the scroll this whole change removes.
     */
    const shift = computeHintShift({ left: -40, right: 500 }, 420);
    expect(shift).toBeGreaterThan(0);
    expect(-40 + shift).toBe(EDGE_GUTTER);
  });

  it('never reports a fractional shift', () => {
    // The property is written as a px string; a fraction would be a subpixel
    // seam against a 1.5px border for no gain. `Number.isInteger` rather than
    // `% 1 === 0`, because -0 % 1 is -0 and Object.is separates it from 0.
    expect(Number.isInteger(computeHintShift({ left: 158.4, right: 418.6 }, PHONE))).toBe(true);
  });

  it('honours a caller-supplied gutter', () => {
    expect(computeHintShift({ left: 100, right: 380 }, PHONE, 0)).toBe(-5);
    expect(computeHintShift({ left: 100, right: 380 }, PHONE, 20)).toBe(-25);
    // And the left gutter takes over when honouring the right one would breach
    // it: pushing this back by 25 would leave only 15px on the left.
    expect(computeHintShift({ left: 40, right: 380 }, PHONE, 20)).toBe(-20);
  });

  it('gives up rather than lie when the popover is wider than the viewport', () => {
    /*
     * 400px of bubble in a 375px viewport cannot satisfy both edges. The left
     * rule wins by design, so the answer is "do not move it" rather than a
     * shift that hides the beginning of the sentence. Asserted because the
     * arithmetic returns it silently, and a future reader could easily take the
     * 0 for "it already fits".
     */
    expect(computeHintShift({ left: 0, right: 400 }, PHONE, 0)).toBe(0);
    expect(computeHintShift({ left: 8, right: 408 }, PHONE)).toBe(0);
  });

  it('keeps every hint on /profile inside the viewport at 375px', () => {
    /*
     * The eight rects measured in the browser BEFORE the fix, at 375x812. Held
     * here so the arithmetic that produced a green browser check is pinned
     * without a DOM — a change to the algorithm that reintroduces the bug fails
     * in `npm test`, not only in a manual pass someone has to remember to run.
     */
    const measured: [string, HorizontalExtentTuple][] = [
      ['Level', [138, 398]],
      ['Streak', [83, 343]],
      ['Adherence', [158, 418]],
      ['Weekly XP', [127, 387]],
      ['Acute : chronic', [128, 388]],
      ['Tonnage', [332, 592]],
      ['Weekly tonnage', [142, 402]],
      ['Estimated 1RM', [165, 425]],
    ];

    for (const [label, [left, right]] of measured) {
      const shift = computeHintShift({ left, right }, PHONE);
      expect(left + shift, `${label} left edge`).toBeGreaterThanOrEqual(0);
      expect(right + shift, `${label} right edge`).toBeLessThanOrEqual(PHONE);
    }
  });
});

type HorizontalExtentTuple = [number, number];
