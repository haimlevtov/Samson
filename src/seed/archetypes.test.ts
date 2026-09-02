/**
 * The acceptance criterion for the seeder is that "every synthetic user's
 * metrics look plausible on manual inspection". Manual inspection still
 * happens — but each archetype exists to represent one specific situation, and
 * whether it actually does is checkable. These tests run the real metrics engine
 * over the generated history and assert the property that makes each case worth
 * seeding at all.
 *
 * WHY that matters: the phase 2 planner is developed against these users. A
 * "plateaued" lifter who is quietly still progressing would let a broken planner
 * look correct.
 */
import { describe, expect, it } from 'vitest';
import { ARCHETYPES, generateHistory, type Archetype, type GeneratedWorkout } from './archetypes';
import { mulberry32 } from './rng';
import { adherence } from '../metrics/adherence';
import { bestE1rm } from '../metrics/e1rm';
import { addDays, daysBetween, startOfWeek } from '../metrics/dates';
import type { SetRecord, WorkoutRecord } from '../metrics/types';

const END = '2026-08-24'; // a Monday

function generate(archetype: Archetype, seed = 42): GeneratedWorkout[] {
  return generateHistory(archetype, END, mulberry32(seed));
}

function byKey(key: string): Archetype {
  const found = ARCHETYPES.find((a) => a.key === key);
  if (!found) throw new Error(`no archetype ${key}`);
  return found;
}

/** Flattens to the shape the metrics engine consumes. */
function toSets(workouts: GeneratedWorkout[]): SetRecord[] {
  return workouts.flatMap((w) =>
    w.sets.map((s) => ({
      exerciseId: s.exerciseSlug,
      weightKg: s.weightKg,
      reps: s.reps,
      rpe: s.rpe,
      isWarmup: s.isWarmup,
      localDate: w.localDate,
    }))
  );
}

function toWorkouts(workouts: GeneratedWorkout[]): WorkoutRecord[] {
  return workouts.map((w, i) => ({ id: String(i), localDate: w.localDate, status: w.status }));
}

/** Best e1RM for one lift within a date range. */
function e1rmBetween(
  sets: SetRecord[],
  exerciseId: string,
  from: string,
  to: string
): number | null {
  return bestE1rm(
    sets.filter((s) => s.exerciseId === exerciseId && s.localDate >= from && s.localDate <= to)
  );
}

interface WeekPoint {
  week: string;
  e1rm: number;
}

/**
 * Best e1RM per ISO week for one lift, ascending.
 *
 * WHY a series rather than two sampled dates: working loads carry ±2% noise and
 * round to plates, so any single week can sit 2.5 kg either side of trend.
 * Comparing two points can therefore show "progress" on a flat programme. The
 * trend is the claim being made, so the trend is what gets measured.
 */
function weeklyE1rm(sets: SetRecord[], exerciseId: string): WeekPoint[] {
  const byWeek = new Map<string, SetRecord[]>();
  for (const set of sets) {
    if (set.exerciseId !== exerciseId) continue;
    const week = startOfWeek(set.localDate);
    const bucket = byWeek.get(week);
    if (bucket) bucket.push(set);
    else byWeek.set(week, [set]);
  }

  return [...byWeek.entries()]
    .map(([week, weekSets]) => ({ week, e1rm: bestE1rm(weekSets) }))
    .filter((point): point is WeekPoint => point.e1rm !== null)
    .sort((a, b) => (a.week < b.week ? -1 : 1));
}

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

describe('every archetype', () => {
  it('covers the five cases PLAN.md names', () => {
    expect(ARCHETYPES.map((a) => a.key).sort()).toEqual([
      'beginner',
      'home-gym',
      'inconsistent',
      'plateaued',
      'returning',
    ]);
  });

  it('produces at least eight weeks of history', () => {
    for (const archetype of ARCHETYPES) {
      const workouts = generate(archetype);
      const earliest = workouts.map((w) => w.localDate).sort()[0]!;
      expect(daysBetween(END, earliest), archetype.key).toBeGreaterThanOrEqual(56);
    }
  });

  it('is deterministic for a given seed and different for another', () => {
    // The whole point of mulberry32 over Math.random: a plausibility judgement
    // is worthless if the data changes on the next run.
    for (const archetype of ARCHETYPES) {
      expect(generate(archetype, 7), archetype.key).toEqual(generate(archetype, 7));
    }
    expect(generate(byKey('beginner'), 7)).not.toEqual(generate(byKey('beginner'), 8));
  });

  it('never logs a session in the future', () => {
    for (const archetype of ARCHETYPES) {
      for (const w of generate(archetype)) expect(w.localDate <= END, archetype.key).toBe(true);
    }
  });

  it('records skipped sessions rather than omitting them', () => {
    // Without a row there is no denominator and adherence is unmeasurable.
    const workouts = generate(byKey('inconsistent'));
    expect(workouts.some((w) => w.status === 'skipped')).toBe(true);
    expect(workouts.filter((w) => w.status === 'skipped').every((w) => w.sets.length === 0)).toBe(
      true
    );
  });

  it('seeds scheduled rest days', () => {
    // INVARIANT: rest maintains a streak — CLAUDE.md #4. Phase 4 needs these to
    // have something to prove that against.
    for (const archetype of ARCHETYPES) {
      expect(
        generate(archetype).some((w) => w.status === 'rest'),
        archetype.key
      ).toBe(true);
    }
  });

  it('accounts for every day of a trained week, so a full week is possible', () => {
    /*
     * The gap this closes, recorded in docs/plans/phase-4.md: the seeder emitted
     * one rest day a week, so a three-day archetype covered four days out of
     * seven and "Seven for Seven" could not fire for anybody. It was verified
     * during phase 4 by adding rest days to the dev database by hand.
     *
     * A programme is seven days long. Every day is trained, rested, or — if the
     * archetype was scheduled and missed it — skipped.
     */
    for (const archetype of ARCHETYPES) {
      const workouts = generate(archetype);
      const byDate = new Map(workouts.map((w) => [w.localDate, w.status]));

      const weeks = new Map<string, string[]>();
      for (const w of workouts) {
        const week = startOfWeek(w.localDate);
        const bucket = weeks.get(week);
        if (bucket) bucket.push(w.status);
        else weeks.set(week, [w.status]);
      }

      for (const [week, statuses] of weeks) {
        /*
         * A layoff week is a genuine absence — the archetype stopped training
         * altogether — and it holds nothing but skipped rows. Filling those in
         * with rest days would hand `returning` an unbroken streak across the
         * months it was away, which is the opposite of what that archetype
         * exists to represent. Only weeks the programme was running are claimed.
         */
        const running = statuses.includes('completed') || statuses.includes('rest');
        if (!running) continue;

        // The final week is truncated at END.
        if (addDays(week, 6) > END) continue;

        // Walk the CALENDAR, not the map's own keys — asking a map about its
        // keys would pass no matter how many days were missing.
        const missing: string[] = [];
        for (let i = 0; i < 7; i++) {
          const date = addDays(week, i);
          if (!byDate.has(date)) missing.push(date);
        }

        expect(missing, `${archetype.key}, week of ${week}`).toEqual([]);
      }
    }
  });

  it('lets a consistent archetype reach seven kept days in a row', () => {
    // The condition `first-full-week` actually tests for — seven consecutive
    // days that are each completed or rest. Without it the achievement is
    // unreachable from a fresh `npm run seed` and cannot be demoed.
    const KEPT = new Set(['completed', 'rest']);

    const longestKeptRun = (archetype: Archetype): number => {
      const byDate = new Map(generate(archetype).map((w) => [w.localDate, w.status]));
      const dates = [...byDate.keys()].sort();

      let best = 0;
      let run = 0;
      let previous: string | null = null;

      for (const date of dates) {
        const consecutive = previous !== null && addDays(previous, 1) === date;
        run = KEPT.has(byDate.get(date)!) ? (consecutive ? run + 1 : 1) : 0;
        best = Math.max(best, run);
        previous = date;
      }
      return best;
    };

    const runs = ARCHETYPES.map((a) => [a.key, longestKeptRun(a)] as const);
    const reachable = runs.filter(([, run]) => run >= 7);

    expect(reachable.length, `longest kept runs: ${JSON.stringify(runs)}`).toBeGreaterThan(0);
  });

  it('gives warmups no RPE and working sets an RPE in range', () => {
    for (const archetype of ARCHETYPES) {
      for (const set of generate(archetype).flatMap((w) => w.sets)) {
        if (set.isWarmup) expect(set.rpe).toBeNull();
        else {
          expect(set.rpe).toBeGreaterThanOrEqual(1);
          expect(set.rpe).toBeLessThanOrEqual(10);
        }
      }
    }
  });

  it('rounds every load to a real plate increment', () => {
    for (const archetype of ARCHETYPES) {
      for (const set of generate(archetype).flatMap((w) => w.sets)) {
        if (set.weightKg === null || set.weightKg === 0) continue;
        expect((set.weightKg * 4) % 10, `${archetype.key} ${set.weightKg}`).toBe(0);
      }
    }
  });
});

describe('beginner', () => {
  it('gets measurably stronger', () => {
    const sets = toSets(generate(byKey('beginner')));
    const first = e1rmBetween(sets, 'barbell-full-squat', '2000-01-01', '2026-06-20')!;
    const last = e1rmBetween(sets, 'barbell-full-squat', '2026-08-01', END)!;
    expect(last).toBeGreaterThan(first * 1.1);
  });

  it('turns up for most sessions', () => {
    const rate = adherence(toWorkouts(generate(byKey('beginner')))).rate!;
    expect(rate).toBeGreaterThan(0.85);
  });
});

describe('plateaued', () => {
  it('progresses at first and then stops, which is the entire point of this user', () => {
    const archetype = byKey('plateaued');
    const series = weeklyE1rm(toSets(generate(archetype)), 'barbell-full-squat');
    const plateauWeek = archetype.plateauAfterWeek!;

    // It has to have been progressing, or it is not a plateau — it is a beginner
    // who never started.
    const before = series.slice(0, plateauWeek);
    expect(mean(before.slice(-2).map((p) => p.e1rm))).toBeGreaterThan(
      mean(before.slice(0, 2).map((p) => p.e1rm)) * 1.1
    );

    // And then it has to be flat. Compared as means over halves of the post-
    // plateau stretch, so plate-rounding noise cannot fake a trend either way.
    const after = series.slice(plateauWeek);
    const half = Math.floor(after.length / 2);
    const earlier = mean(after.slice(0, half).map((p) => p.e1rm));
    const later = mean(after.slice(half).map((p) => p.e1rm));
    expect(later).toBeLessThan(earlier * 1.03);
    expect(later).toBeGreaterThan(earlier * 0.97);
  });

  it('is not simply lazy — adherence stays high', () => {
    // Distinguishes a plateau from a consistency problem, which need different
    // interventions from the coach.
    expect(adherence(toWorkouts(generate(byKey('plateaued')))).rate!).toBeGreaterThan(0.85);
  });
});

describe('returning', () => {
  it('has a real gap with no completed training', () => {
    const workouts = generate(byKey('returning'));
    const completed = workouts
      .filter((w) => w.status === 'completed')
      .map((w) => w.localDate)
      .sort();

    let longestGap = 0;
    for (let i = 1; i < completed.length; i++) {
      longestGap = Math.max(longestGap, daysBetween(completed[i]!, completed[i - 1]!));
    }
    expect(longestGap).toBeGreaterThanOrEqual(28);
  });

  it('comes back lighter than it left', () => {
    // Resuming at the pre-layoff load is the injury this archetype represents,
    // and the thing the phase 2 planner has to get right.
    const series = weeklyE1rm(toSets(generate(byKey('returning'))), 'barbell-full-squat');

    // Find the gap in the series itself: weeks with squat work are what matter,
    // not every completed session — a deadlift day has no squats in it.
    let gapIndex = -1;
    let widest = 0;
    for (let i = 1; i < series.length; i++) {
      const gap = daysBetween(series[i]!.week, series[i - 1]!.week);
      if (gap > widest) {
        widest = gap;
        gapIndex = i;
      }
    }

    expect(widest).toBeGreaterThanOrEqual(28);
    expect(series[gapIndex]!.e1rm).toBeLessThan(series[gapIndex - 1]!.e1rm);
  });
});

describe('home-gym', () => {
  const archetype = byKey('home-gym');

  it('never exceeds the dumbbell ceiling', () => {
    // INVARIANT: capped equipment is a hard ceiling — CLAUDE.md #5.
    for (const set of generate(archetype).flatMap((w) => w.sets)) {
      if (set.weightKg !== null) expect(set.weightKg).toBeLessThanOrEqual(30);
    }
  });

  it('programmes nothing that needs a barbell', () => {
    // This user is how invariant #5 gets proven: prescribing a barbell lift here
    // is visibly wrong rather than subtly wrong.
    const slugs = archetype.programme.map((e) => e.exerciseSlug);
    expect(slugs.some((s) => s.startsWith('barbell-'))).toBe(false);
    expect(archetype.equipment.some((e) => e.slug === 'barbell')).toBe(false);
  });

  it('declares the cap on the equipment grant, not just in the data', () => {
    const dumbbell = archetype.equipment.find((e) => e.slug === 'dumbbell')!;
    expect(dumbbell.maxLoadKg).toBe(30);
  });
});

describe('inconsistent', () => {
  it('lands near half adherence', () => {
    const rate = adherence(toWorkouts(generate(byKey('inconsistent')))).rate!;
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.7);
  });

  it('is clearly worse than the beginner, so the two cases are distinguishable', () => {
    const sloppy = adherence(toWorkouts(generate(byKey('inconsistent')))).rate!;
    const diligent = adherence(toWorkouts(generate(byKey('beginner')))).rate!;
    expect(diligent - sloppy).toBeGreaterThan(0.25);
  });

  it('ends up weaker than the beginner, because progression follows sessions', () => {
    // Regression: load used to advance on the calendar, so this user reached a
    // heavier squat than the beginner while completing 19 sessions to their 32.
    // A planner developed against that data would look correct while being wrong.
    const lift = 'barbell-full-squat';
    const sloppy = weeklyE1rm(toSets(generate(byKey('inconsistent'))), lift);
    const diligent = weeklyE1rm(toSets(generate(byKey('beginner'))), lift);
    expect(sloppy.at(-1)!.e1rm).toBeLessThan(diligent.at(-1)!.e1rm);
  });
});
