/**
 * The calorie engine, tested as properties over a sweep rather than as examples.
 *
 * WHY properties: the acceptance criterion for this phase is adversarial — "no
 * prompt, persona, or user framing moves the calorie floor" — and an example
 * proves the floor holds for the case somebody thought of. A sweep proves it for
 * every combination the columns admit, which is what the criterion actually
 * claims. `docs/specs/diet.md` §5 is the list this file implements.
 *
 * Runs with no database, no network and no API key.
 */
import { describe, expect, it } from 'vitest';

import { MAX_BODYWEIGHT_KG, MAX_HEIGHT_CM, SEXES } from './biometrics';
import {
  ABSOLUTE_FLOOR_KCAL,
  DIET_GOALS,
  MAX_DEFICIT_FRACTION,
  MAX_SURPLUS_FRACTION,
  MIN_AGE_YEARS,
  TARGET_CEILING_KCAL,
  activityTier,
  ageOn,
  boundedAdjustment,
  computeEnergy,
  mifflinStJeor,
  normaliseGoal,
  proteinTarget,
  type EnergyInput,
  type EnergyResult,
  type EnergyTarget,
} from './energy';

const TODAY = '2026-09-09';

/** A birth date that makes somebody exactly `age` today. */
function bornAged(age: number): string {
  return `${Number(TODAY.slice(0, 4)) - age}${TODAY.slice(4)}`;
}

function input(overrides: Partial<EnergyInput> = {}): EnergyInput {
  return {
    today: TODAY,
    bodyweightKg: 82,
    heightCm: 180,
    birthDate: bornAged(31),
    sex: 'male',
    sessionsLast28Days: 12,
    goal: 'maintain',
    ...overrides,
  };
}

const ok = (result: EnergyResult): EnergyTarget => {
  if (result.kind !== 'ok') throw new Error(`expected a target, got ${result.kind}`);
  return result;
};

/*
 * The sweep. Every value is one the database now admits, plus the edges of what
 * it admits, because the edges are where a clamp is decided.
 *
 * 8 × 7 × 6 × 3 × 7 × 5 = 35,280 combinations, and each one is arithmetic.
 */
const WEIGHTS = [1, 40, 62, 84, 120, 200, 635, 999.99];
const HEIGHTS = [1, 140, 166, 183, 220, 272, 299.9];
const AGES = [18, 25, 40, 65, 90, 120];
const SESSIONS = [0, 1, 4, 12, 20, 28, 60];
const GOALS = [...DIET_GOALS, '', 'bulk'];

/**
 * Collects the inputs that break a property, rather than asserting inside the
 * loop.
 *
 * WHY: an `expect` per iteration is 35,280 assertions, and a message argument is
 * evaluated eagerly — so `JSON.stringify(where)` ran on every one of them and
 * pushed the suite past its timeout under coverage instrumentation. Checking
 * first and reporting the failures that exist is both faster and a better
 * failure message: the first few offending inputs, not one.
 */
function check(holds: (result: EnergyResult, where: EnergyInput) => boolean, limit = 3): string[] {
  const broken: string[] = [];
  sweep((result, where) => {
    if (broken.length < limit && !holds(result, where)) {
      broken.push(`${JSON.stringify(where)} → ${JSON.stringify(result)}`);
    }
  });
  return broken;
}

function sweep(visit: (result: EnergyResult, where: EnergyInput) => void): number {
  let seen = 0;
  for (const bodyweightKg of WEIGHTS) {
    for (const heightCm of HEIGHTS) {
      for (const age of AGES) {
        for (const sex of SEXES) {
          for (const sessionsLast28Days of SESSIONS) {
            for (const goal of GOALS) {
              const where = input({
                bodyweightKg,
                heightCm,
                birthDate: bornAged(age),
                sex,
                sessionsLast28Days,
                goal,
              });
              visit(computeEnergy(where), where);
              seen += 1;
            }
          }
        }
      }
    }
  }
  return seen;
}

describe('the sweep', () => {
  it('covers what it claims to', () => {
    expect(sweep(() => {})).toBe(35_280);
  });

  it('never returns anything but a target or a named refusal', () => {
    const kinds = ['ok', 'missing-biometric', 'under-18', 'implausible-input'];
    expect(check((result) => kinds.includes(result.kind))).toEqual([]);
  });

  /** THE property. If only one test in this file survives, it is this one. */
  it('never produces a target below the floor', () => {
    expect(
      check(
        (result) =>
          result.kind !== 'ok' ||
          (result.targetKcal >= result.floorKcal &&
            result.floorKcal === Math.max(result.bmrKcal, ABSOLUTE_FLOOR_KCAL) &&
            result.targetKcal >= ABSOLUTE_FLOOR_KCAL)
      )
    ).toEqual([]);
  });

  it('never produces a target above the ceiling', () => {
    expect(
      check((result) => result.kind !== 'ok' || result.targetKcal < TARGET_CEILING_KCAL)
    ).toEqual([]);
  });

  it('produces only finite, positive whole numbers', () => {
    expect(
      check((result) => {
        if (result.kind !== 'ok') return true;
        const values = [
          result.bmrKcal,
          result.tdeeKcal,
          result.targetKcal,
          result.floorKcal,
          result.proteinG,
        ];
        // Positive, not merely finite: a negative BMR passed the clamp once.
        return (
          values.every((value) => Number.isInteger(value) && value > 0) &&
          Number.isFinite(result.sessionsPerWeek)
        );
      })
    ).toEqual([]);
  });

  /*
   * The floor can push a target ABOVE the goal's surplus bound as well as above
   * its deficit bound — a small person whose BMR is under 1,200 gets the
   * absolute floor, which may exceed TDEE + 15%. That is what a floor is for,
   * and the first version of this test asserted the upper bound
   * unconditionally and failed on exactly that case.
   *
   * So the property is: the clamp decided the number, or the goal did, and
   * `floorReached` says which. There is no third source.
   */
  it('is bounded by the goal, or by the floor, and says which', () => {
    expect(
      check((result) => {
        if (result.kind !== 'ok') return true;
        if (result.floorReached) return result.targetKcal === result.floorKcal;

        /*
         * `floor`/`ceil` rather than `round`, because the target is rounded to
         * whole kcal and the bound has to survive that. It also has to survive
         * IEEE754: `1470 * 1.15` is 1690.4999999999998 while
         * `1470 + 1470 * 0.15` is 1690.5, so a `round` on each side disagreed
         * by one kcal and failed here on a case no example would have reached.
         */
        return (
          result.targetKcal >= Math.floor(result.tdeeKcal * (1 - MAX_DEFICIT_FRACTION)) &&
          result.targetKcal <= Math.ceil(result.tdeeKcal * (1 + MAX_SURPLUS_FRACTION))
        );
      })
    ).toEqual([]);
  });

  it('never turns an unrecognised goal into a deficit', () => {
    for (const goal of ['', 'bulk', 'CUT', 'lose weight', 'cut ']) {
      const result = computeEnergy(input({ goal }));
      const target = ok(result);
      expect(normaliseGoal(goal), goal).toBe('maintain');
      expect(target.isDeficit, goal).toBe(false);
      expect(target.targetKcal, goal).toBeGreaterThanOrEqual(target.tdeeKcal);
    }
  });
});

describe('monotonicity', () => {
  it('is never fewer calories for being heavier', () => {
    let previous = 0;
    for (const bodyweightKg of WEIGHTS) {
      const result = computeEnergy(input({ bodyweightKg, goal: 'cut' }));
      if (result.kind !== 'ok') continue;
      expect(result.targetKcal, `at ${bodyweightKg} kg`).toBeGreaterThanOrEqual(previous);
      previous = result.targetKcal;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it('is never fewer calories for training more', () => {
    let previous = 0;
    for (const sessionsLast28Days of SESSIONS) {
      const target = ok(computeEnergy(input({ sessionsLast28Days })));
      expect(target.targetKcal, `at ${sessionsLast28Days} sessions`).toBeGreaterThanOrEqual(
        previous
      );
      previous = target.targetKcal;
    }
  });

  /*
   * The safe-direction rule, asserted rather than commented — ADR 0024 §3.
   * `unspecified` takes the male constant, the higher of the two, so it can
   * never prescribe less food than `female` would for the same body.
   */
  it('never gives `unspecified` less than `female` would', () => {
    for (const bodyweightKg of WEIGHTS) {
      for (const heightCm of HEIGHTS) {
        for (const goal of DIET_GOALS) {
          const asFemale = computeEnergy(input({ bodyweightKg, heightCm, sex: 'female', goal }));
          const asUnspecified = computeEnergy(
            input({ bodyweightKg, heightCm, sex: 'unspecified', goal })
          );
          if (asFemale.kind !== 'ok' || asUnspecified.kind !== 'ok') continue;
          expect(asUnspecified.targetKcal).toBeGreaterThanOrEqual(asFemale.targetKcal);
        }
      }
    }
  });
});

describe('refusals', () => {
  it('names the missing biometric rather than defaulting it', () => {
    const fields = [
      ['bodyweightKg', { bodyweightKg: null }],
      ['heightCm', { heightCm: null }],
      ['birthDate', { birthDate: null }],
      ['sex', { sex: null }],
    ] as const;

    for (const [name, override] of fields) {
      const result = computeEnergy(input(override));
      expect(result.kind, name).toBe('missing-biometric');
      expect(result.kind === 'missing-biometric' && result.missing).toBe(name);
    }
  });

  /*
   * The case that motivates the whole branch: NaN is NOT null, so without this
   * it would pass the missing-biometric check, propagate through Math.min and
   * Math.max untouched by the clamp, and render as a prescription.
   */
  it('refuses non-finite input rather than propagating it', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const override of [
        { bodyweightKg: value },
        { heightCm: value },
        { sessionsLast28Days: value },
      ]) {
        const result = computeEnergy(input(override));
        expect(result.kind, `${value} in ${Object.keys(override)[0]}`).toBe('implausible-input');
      }
    }
  });

  it('refuses a magnitude the column would admit but a body would not', () => {
    for (const override of [
      { bodyweightKg: MAX_BODYWEIGHT_KG },
      { bodyweightKg: 9999.99 },
      { bodyweightKg: 0 },
      { bodyweightKg: -5 },
      { heightCm: MAX_HEIGHT_CM },
      { heightCm: 9999.9 },
      { heightCm: 0 },
    ]) {
      expect(computeEnergy(input(override)).kind, JSON.stringify(override)).toBe(
        'implausible-input'
      );
    }
  });

  /*
   * FOUND BY THE SWEEP. Every one of these values is inside the column bounds,
   * and the equation still returns a negative resting rate — the floor then
   * produces a perfectly sensible 1,200 kcal target sitting beside a BMR of
   * −745. Caught here rather than by a reader of the diet block.
   */
  it('refuses a body the equation returns nothing positive for', () => {
    const result = computeEnergy(
      input({ bodyweightKg: 1, heightCm: 1, birthDate: bornAged(120), sex: 'female' })
    );
    expect(result.kind).toBe('implausible-input');
    expect(result.kind === 'implausible-input' && result.reason).toBe('no-resting-rate');
  });

  it('refuses when the figures reach the ceiling', () => {
    // Inside every column bound, and still not a person: 900 kg at 250 cm.
    const result = computeEnergy(input({ bodyweightKg: 900, heightCm: 250 }));
    expect(result.kind).toBe('implausible-input');
    expect(result.kind === 'implausible-input' && result.reason).toBe('ceiling');
  });

  it('refuses a date that is not a date', () => {
    for (const birthDate of ['not-a-date', '1995-7-2', '19950702', '']) {
      const result = computeEnergy(input({ birthDate }));
      expect(result.kind, birthDate).toBe('implausible-input');
    }
  });
});

describe('the under-18 gate', () => {
  it('refuses below eighteen and admits at exactly eighteen', () => {
    expect(computeEnergy(input({ birthDate: bornAged(17) })).kind).toBe('under-18');
    expect(computeEnergy(input({ birthDate: bornAged(MIN_AGE_YEARS) })).kind).toBe('ok');
  });

  /*
   * Evaluated against a SUPPLIED today, so the boundary is testable on both
   * sides of a birthday — and so that the question is asked in the user's own
   * timezone rather than the server's, CLAUDE.md #9.
   */
  it('turns eighteen on the birthday, not before it', () => {
    const eighteenthBirthday = '2026-09-09';
    const born = '2008-09-09';

    expect(computeEnergy(input({ birthDate: born, today: '2026-09-08' })).kind).toBe('under-18');
    expect(computeEnergy(input({ birthDate: born, today: eighteenthBirthday })).kind).toBe('ok');
  });

  it('reports the age it refused on, so the surface can be specific', () => {
    const result = computeEnergy(input({ birthDate: bornAged(14) }));
    expect(result.kind === 'under-18' && result.ageYears).toBe(14);
  });
});

describe('the pieces, separately', () => {
  it('computes Mifflin–St Jeor with the published constants', () => {
    // 10(80) + 6.25(180) − 5(30) + 5 = 1780
    expect(mifflinStJeor(80, 180, 30, 'male')).toBeCloseTo(1780, 6);
    // The same body with the female constant: 166 lower.
    expect(mifflinStJeor(80, 180, 30, 'female')).toBeCloseTo(1780 - 166, 6);
    expect(mifflinStJeor(80, 180, 30, 'unspecified')).toBeCloseTo(1780, 6);
  });

  it('reads the activity bands off sessions per week', () => {
    const cases: ReadonlyArray<[number, string, number]> = [
      [0, 'sedentary', 1.2],
      [0.49, 'sedentary', 1.2],
      [0.5, 'light', 1.375],
      [2.99, 'light', 1.375],
      [3, 'moderate', 1.55],
      [4.99, 'moderate', 1.55],
      [5, 'high', 1.725],
      [6.99, 'high', 1.725],
      [7, 'very high', 1.9],
      [40, 'very high', 1.9],
    ];
    for (const [sessions, band, factor] of cases) {
      expect(activityTier(sessions).band, String(sessions)).toBe(band);
      expect(activityTier(sessions).factor, String(sessions)).toBe(factor);
    }
  });

  it('bounds the adjustment in both directions', () => {
    expect(boundedAdjustment(2000, 'cut')).toBeCloseTo(-400, 6);
    expect(boundedAdjustment(2000, 'gain')).toBeCloseTo(300, 6);
    expect(boundedAdjustment(2000, 'maintain')).toBe(0);
    expect(boundedAdjustment(2000, 'anything else')).toBe(0);
  });

  it('computes protein from bodyweight, in whole grams', () => {
    expect(proteinTarget(80)).toBe(144);
    expect(proteinTarget(62.5)).toBe(113);
  });

  it('counts age in whole years against a supplied today', () => {
    expect(ageOn('1995-07-02', '2026-09-09')).toBe(31);
    expect(ageOn('1995-09-09', '2026-09-09')).toBe(31);
    expect(ageOn('1995-09-10', '2026-09-09')).toBe(30);
  });

  /*
   * A leap-year birthday has no 29 February in most years. `2027-02-29` sorts
   * after `2027-02-28`, so this person's age increments on 1 March — a day late
   * rather than a day early, which is the safe direction for a gate that
   * withholds a calorie target from a minor.
   */
  it('makes a 29 February birthday age on 1 March in a non-leap year', () => {
    expect(ageOn('2008-02-29', '2027-02-28')).toBe(18);
    expect(ageOn('2008-02-29', '2027-03-01')).toBe(19);
    expect(ageOn('2008-02-29', '2028-02-29')).toBe(20);
  });
});

describe('what a target reports about itself', () => {
  it('marks a deficit as one', () => {
    const cut = ok(computeEnergy(input({ goal: 'cut', sessionsLast28Days: 20 })));
    expect(cut.isDeficit).toBe(true);
    expect(cut.floorReached).toBe(false);

    const gain = ok(computeEnergy(input({ goal: 'gain' })));
    expect(gain.isDeficit).toBe(false);
  });

  /*
   * A light trainer cutting: 0.8 × 1.2 = 0.96 of BMR, which is below it, so the
   * floor decides the number instead of the goal. That is the case the whole
   * clamp exists for, and the flag is what lets the surface say so.
   */
  it('says when the floor decided the number rather than the goal', () => {
    const result = ok(computeEnergy(input({ goal: 'cut', sessionsLast28Days: 0 })));
    expect(result.floorReached).toBe(true);
    expect(result.targetKcal).toBe(result.floorKcal);
    expect(result.targetKcal).toBe(result.bmrKcal);
  });

  it('carries the local date it was computed against', () => {
    expect(ok(computeEnergy(input({ today: '2026-01-02' }))).asOf).toBe('2026-01-02');
  });
});
