/**
 * Deterministic pseudo-randomness for the seeder.
 *
 * WHY not Math.random: `npm run seed` must produce the same database every time.
 * PLAN.md's acceptance criterion is that every synthetic user's metrics "look
 * plausible on manual inspection" — a judgement that is worthless if the numbers
 * change on the next run, and impossible to file a bug against.
 *
 * WHY mulberry32 rather than a dependency: it is ten lines, has no install
 * footprint, and its quality is far beyond what fake workout logs require.
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inclusive of both bounds. */
export function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('cannot pick from an empty list');
  return items[Math.floor(rng() * items.length)]!;
}

/** True with the given probability. */
export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

/** Scales `value` by ±`fraction`, e.g. 0.05 for ±5%. */
export function jitter(rng: Rng, value: number, fraction: number): number {
  return value * (1 + (rng() * 2 - 1) * fraction);
}

/**
 * WHY loads round to 2.5 kg: that is the smallest plate pair on a real bar, and
 * a seeded history full of 63.7 kg squats reads as fake on sight — which is
 * exactly what the manual-inspection criterion is checking for.
 */
export function roundToPlate(kg: number, increment = 2.5): number {
  return Math.max(increment, Math.round(kg / increment) * increment);
}
