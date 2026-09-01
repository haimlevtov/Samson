/**
 * The acceptance criterion, made executable.
 *
 * PLAN.md phase 3: "Persona layer cannot alter any number in the plan it
 * receives — asserted by test, not by prompt."
 */
import { describe, expect, it } from 'vitest';
import type { TrainingBlock } from '../planner/schema';
import {
  InventedNumberError,
  assertNoInventedNumbers,
  blockNumbers,
  findInventedNumbers,
} from './guard';
import type { DeliveredPlan } from './schema';

/** One week, one session, one exercise: 3 sets of 5 at 62.5 kg, RPE 8, 120 s rest. */
const BLOCK: TrainingBlock = {
  rationale: 'test',
  weeks: [
    {
      week_number: 1,
      is_deload: false,
      sessions: [
        {
          day_index: 0,
          focus: 'lower',
          exercises: [
            {
              exercise_slug: 'barbell-full-squat',
              sets: [0, 1, 2].map((i) => ({
                set_index: i,
                weight_kg: 62.5,
                reps: 5,
                rpe: 8,
                rest_seconds: 120,
              })),
            },
          ],
        },
      ],
    },
  ],
};

const delivered = (text: string): DeliveredPlan => ({
  opening: text,
  week_notes: ['week note'],
  closing: 'closing',
});

describe('blockNumbers', () => {
  it('collects the values the block actually contains', () => {
    const allowed = blockNumbers(BLOCK);
    for (const n of [62.5, 5, 8, 120]) expect(allowed).toContain(n);
  });

  it('collects counts, which describe the block rather than compute over it', () => {
    const allowed = blockNumbers(BLOCK);
    expect(allowed).toContain(1); // one week, one session, one exercise, set one
    expect(allowed).toContain(3); // three sets
  });

  it('allows rest in minutes only when it divides cleanly', () => {
    expect(blockNumbers(BLOCK)).toContain(2); // 120 s
    const odd: TrainingBlock = structuredClone(BLOCK);
    odd.weeks[0]!.sessions[0]!.exercises[0]!.sets[0]!.rest_seconds = 105;
    // 1.75 minutes would be arithmetic out loud, not quoting.
    expect(blockNumbers(odd)).not.toContain(1.75);
  });
});

describe('findInventedNumbers', () => {
  it('accepts prose that only quotes the plan', () => {
    const text = 'Three sets of 5 at 62.5 kg, RPE 8, resting 120 seconds.';
    expect(findInventedNumbers(BLOCK, text)).toEqual([]);
  });

  it('catches a load the plan does not contain', () => {
    // The realistic failure: plausible, adjacent, and wrong.
    expect(findInventedNumbers(BLOCK, 'Work up to 65 kg.')).toEqual([65]);
  });

  it('catches derived arithmetic, which is the strict part of ADR 0006', () => {
    // 62.5 x 5 x 3 = 937.5. Correct, and still rejected: the persona did a sum.
    expect(findInventedNumbers(BLOCK, 'That is 937.5 kg of total volume.')).toEqual([937.5]);
  });

  it('catches an invented percentage', () => {
    expect(findInventedNumbers(BLOCK, 'You are up 10% on last month.')).toEqual([10]);
  });

  it('reports each invented number once, however often it appears', () => {
    expect(findInventedNumbers(BLOCK, '65 kg, then 65 kg again, then 65 kg')).toEqual([65]);
  });

  it('ignores number words, which are not numerals', () => {
    // "ten" is not caught. Documented rather than pretended away: the guard is
    // over digits, and a persona spelling a number out evades it.
    expect(findInventedNumbers(BLOCK, 'Add ten kilos.')).toEqual([]);
  });
});

describe('assertNoInventedNumbers', () => {
  it('passes a delivery that quotes the plan', () => {
    expect(() =>
      assertNoInventedNumbers(BLOCK, delivered('62.5 kg for 5, three sets.'))
    ).not.toThrow();
  });

  it('throws with the offending numbers named', () => {
    try {
      assertNoInventedNumbers(BLOCK, delivered('Push to 70 kg for 12.'));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InventedNumberError);
      expect((error as InventedNumberError).numbers).toEqual([70, 12]);
    }
  });

  it('checks the week notes and the closing, not only the opening', () => {
    expect(() =>
      assertNoInventedNumbers(BLOCK, {
        opening: 'Fine.',
        week_notes: ['Then 999 kg.'],
        closing: 'Fine.',
      })
    ).toThrow(InventedNumberError);

    expect(() =>
      assertNoInventedNumbers(BLOCK, {
        opening: 'Fine.',
        week_notes: ['Fine.'],
        closing: 'Finish at 999 kg.',
      })
    ).toThrow(InventedNumberError);
  });
});
