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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EARLIEST_BIRTH_DATE,
  MAX_BODYWEIGHT_KG,
  MAX_HEIGHT_CM,
  SEXES,
  isFutureBirthDate,
} from '../diet/biometrics';
import {
  ARCHETYPES,
  generateHistory,
  outOfGrant,
  templatesFor,
  toTemplateDraft,
  type Archetype,
  type EquipmentOf,
  type GeneratedWorkout,
  type ProgrammeEntry,
} from './archetypes';
import { mulberry32 } from './rng';
import { templateDraftSchema } from '../templates/schema';
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

  /*
   * The biometrics the seeder writes, checked against the same bounds the
   * database enforces — 20260909120000_user_biometrics_bounds.sql, imported
   * rather than retyped.
   *
   * WHY this is worth a test: an out-of-bounds value here breaks `npm run seed`
   * at the point a demo is being rebuilt, and an archetype who is UNDER 18 would
   * make the diet block render ADR 0024 §6's refusal for a demo user — the exact
   * "not a demo" failure the seeded biometrics exist to prevent, and one nothing
   * else would catch until somebody opened the page.
   */
  it('gives every archetype biometrics the database and the advisor will accept', () => {
    for (const archetype of ARCHETYPES) {
      const where = archetype.key;

      expect(archetype.bodyweightKg, where).toBeGreaterThan(0);
      expect(archetype.bodyweightKg, where).toBeLessThan(MAX_BODYWEIGHT_KG);
      expect(archetype.heightCm, where).toBeGreaterThan(0);
      expect(archetype.heightCm, where).toBeLessThan(MAX_HEIGHT_CM);

      expect(SEXES, where).toContain(archetype.sex);

      expect(archetype.birthDate, where).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(archetype.birthDate >= EARLIEST_BIRTH_DATE, where).toBe(true);
      expect(isFutureBirthDate(archetype.birthDate, END), where).toBe(false);

      // Eighteen years before the history window ends. String comparison is
      // safe on zero-padded ISO dates, the same property isFutureBirthDate uses.
      const eighteenthBirthday = `${Number(archetype.birthDate.slice(0, 4)) + 18}${archetype.birthDate.slice(4)}`;
      expect(eighteenthBirthday <= END, `${where} must be an adult`).toBe(true);
    }
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

  describe('an entry the rotation can never reach', () => {
    /*
     * `generateHistory` filters entries with `e.day === day % PROGRAMME_DAYS`,
     * so an entry with `day: 3` matches no iteration and contributes nothing —
     * silently, which is the whole problem. It is the natural thing to write for
     * a four-day archetype, and two of the five really do train four days a
     * week; they cycle back to session 0 on the fourth.
     *
     * A dropped accessory is a progression-tree rung nobody can open with
     * nothing to say why — the failure the bodyweight accessories were added to
     * fix in the first place.
     *
     * AI-NOTE: only the "names the exercise" case asserts the wording — there
     *          the diagnostic IS the feature. The rest assert the throw alone,
     *          so rephrasing the message does not turn five tests red. If the
     *          rotation ever grows, change PROGRAMME_DAYS and the day numbers
     *          here; do not delete the cases.
     */
    const withEntry = (entry: Partial<ProgrammeEntry>): Archetype => {
      const base = byKey('plateaued'); // daysPerWeek: 4, which is the trap
      return {
        ...base,
        programme: [
          ...base.programme,
          {
            exerciseSlug: 'pushups',
            sets: 3,
            reps: 10,
            startingKg: 0,
            incrementKg: 0,
            day: 0,
            ...entry,
          },
        ],
      };
    };

    it('refuses a day past the end of the rotation', () => {
      expect(() => generate(withEntry({ day: 3 }))).toThrow();
      expect(() => generate(withEntry({ day: 9 }))).toThrow();
    });

    it('names the exercise and the day, so the typo is findable', () => {
      // A guard that says only "invalid programme" makes the author re-read
      // forty entries. The point is to land them on the one line, so this is
      // the one case where the message text is the thing under test.
      expect(() => generate(withEntry({ day: 3 }))).toThrow(/pushups has day 3/);
    });

    it('refuses a negative or fractional day', () => {
      expect(() => generate(withEntry({ day: -1 }))).toThrow();
      expect(() => generate(withEntry({ day: 1.5 }))).toThrow();
    });

    it('accepts every day the rotation does reach', () => {
      for (const day of [0, 1, 2]) {
        expect(() => generate(withEntry({ day })), `day ${day}`).not.toThrow();
      }
    });

    it('refuses the rest of the class, not just the day', () => {
      /*
       * FOUND IN REVIEW: the first version of this guard checked `day` alone.
       * Every one of these vanishes the same way — silently — and two of them
       * are worse than an absent lift, because the exercise still appears in
       * history having never been worked.
       */
      expect(() => generate(withEntry({ sets: 0 })), 'sets: 0').toThrow();
      expect(() => generate(withEntry({ reps: 0 })), 'reps: 0').toThrow();
      expect(() => generate(withEntry({ startingKg: -5 })), 'negative load').toThrow();
    });

    it('refuses a rotation day with nothing in it', () => {
      /*
       * The inverse of the day check, and the more expensive omission: a day
       * with no entries produces no workout row at all — not completed, not
       * skipped, not a rest day — so the date disappears and the adherence
       * denominator shrinks with it.
       */
      const base = byKey('plateaued');
      const missingDayTwo: Archetype = {
        ...base,
        programme: base.programme.filter((e) => e.day !== 2),
      };
      expect(() => generate(missingDayTwo)).toThrow(/session 2/);
    });

    it('leaves the shipped archetypes alone', () => {
      // The guard runs on every call, so a false positive here would take out
      // the seeder and the golden suite together.
      for (const archetype of ARCHETYPES) {
        expect(() => generate(archetype), archetype.key).not.toThrow();
      }
    });
  });

  it('prescribes only exercises the committed catalogue has', () => {
    /*
     * The same silent-drop class, one layer down and outside this file:
     * `scripts/seed.ts` maps each slug to a catalogue id, and a miss used to
     * drop the sets — leaving a workout marked `completed` with nothing in it,
     * still awarded XP, while tests/planner/golden.ts built its ids from the
     * slug with no lookup and so described a different history for the same
     * person. The seeder throws now; this catches it offline, before anyone
     * needs a database to find out.
     *
     * AI-NOTE: reads the COMMITTED snapshot, so `npm run catalogue:fetch`
     *          dropping an exercise fails here rather than at seed time.
     */
    const snapshot = JSON.parse(
      readFileSync(resolve(process.cwd(), 'data/exercises.snapshot.json'), 'utf8')
    ) as { exercises: { slug: string }[] };
    const known = new Set(snapshot.exercises.map((e) => e.slug));

    const missing = [
      ...new Set(
        ARCHETYPES.flatMap((a) => a.programme.map((e) => e.exerciseSlug)).filter(
          (slug) => !known.has(slug)
        )
      ),
    ];

    expect(missing, 'prescribed exercises absent from data/exercises.snapshot.json').toEqual([]);
  });

  describe('an appended entry draws from the side stream', () => {
    /*
     * The property the `appended` flag exists for, which the determinism case
     * above cannot see: it compares a seed against ITSELF, so it passes whether
     * or not an appended entry perturbs the shared stream.
     *
     * WHY it needs guarding: `generateHistory` runs one RNG through the whole
     * history, so an entry that draws from it shifts every draw after it — each
     * load's jitter and each adherence roll, in every archetype sharing the
     * programme. That is not theoretical; it broke
     * `tests/unit/planner-golden.test.ts` when these accessories were first
     * added, and the golden fixtures are built on the exact numbers.
     *
     * AI-NOTE: if you add an entry WITHOUT `appended`, this goes red and it is
     *          telling the truth. Either mark it appended or accept the
     *          re-baseline and re-read the golden suite. Do not delete this.
     */
    const APPENDED_SLUGS = new Set(
      ARCHETYPES.flatMap((a) => a.programme)
        .filter((e) => e.appended === true)
        .map((e) => e.exerciseSlug)
    );

    /** The same archetype with every appended entry removed. */
    function withoutAppended(archetype: Archetype): Archetype {
      return { ...archetype, programme: archetype.programme.filter((e) => e.appended !== true) };
    }

    it('leaves every other set byte-identical', () => {
      expect(APPENDED_SLUGS.size, 'nothing is marked appended').toBeGreaterThan(0);

      for (const archetype of ARCHETYPES) {
        const strip = (workouts: GeneratedWorkout[]) =>
          workouts.map((w) => ({
            ...w,
            sets: w.sets.filter((s) => !APPENDED_SLUGS.has(s.exerciseSlug)),
          }));

        expect(strip(generate(archetype)), archetype.key).toEqual(
          strip(generate(withoutAppended(archetype)))
        );
      }
    });

    it('still varies the appended sets session to session', () => {
      // WHY this is the second half: suppressing the draws entirely would also
      // pass the test above, and would give every accessory set in twelve weeks
      // the same rest and the same RPE — the "reads as fake on sight" failure
      // roundToPlate exists to avoid. The side stream keeps the variety.
      const appendedSets = generate(byKey('beginner'))
        .flatMap((w) => w.sets)
        .filter((s) => APPENDED_SLUGS.has(s.exerciseSlug));

      expect(appendedSets.length, 'the beginner logs no appended sets').toBeGreaterThan(20);
      expect(new Set(appendedSets.map((s) => s.restSeconds)).size).toBeGreaterThan(1);
      expect(new Set(appendedSets.map((s) => s.rpe)).size).toBeGreaterThan(1);
    });
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

  it('squats enough to clear the lunge rung in every session, not once', () => {
    /*
     * The legs tree's lunge rung opens on 3 × 20 bodyweight squats in one
     * completed session — migration 20260911120000. Home-gym is prescribed 21
     * because a later set drops a rep a quarter of the time, and this is where
     * that margin is held. FOUND IN REVIEW: at 20, a third of his sessions still
     * clear the rung, so the climb pinned in tests/db/progression.test.ts stays
     * green and cannot see the margin go. This goes red at 20.
     *
     * Several seeds, because one seed can clear by luck what another does not.
     *
     * AI-NOTE: 20 and 3 here are the lunge rung's criterion, restated. Change
     *          the rung in a migration and change them with it.
     */
    for (const seed of [7, 42, 1234]) {
      const squatting = generate(archetype, seed).filter(
        (w) => w.status === 'completed' && w.sets.some((s) => s.exerciseSlug === 'bodyweight-squat')
      );
      expect(squatting.length, `seed ${seed}: no squat sessions at all`).toBeGreaterThan(0);

      for (const workout of squatting) {
        const clearing = workout.sets.filter(
          (s) => s.exerciseSlug === 'bodyweight-squat' && !s.isWarmup && s.reps >= 20
        );
        expect(clearing.length, `seed ${seed}, ${workout.localDate}`).toBeGreaterThanOrEqual(3);
      }
    }
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

/**
 * The Workout tab's templates — rework plan PR 5.
 *
 * The plan's acceptance names the equipment ceiling as the case that matters: a
 * template is something the user taps Start on, so a prescription the home-gym
 * lifter cannot load — or a lift his equipment cannot do — is a session that
 * fails at the first set.
 */
describe('the templates each archetype is seeded with', () => {
  const EQUIPMENT_OF: EquipmentOf = new Map(
    (
      JSON.parse(readFileSync(resolve(process.cwd(), 'data/exercises.snapshot.json'), 'utf8')) as {
        exercises: { slug: string; equipment: string }[];
      }
    ).exercises.map((e) => [e.slug, e.equipment])
  );

  const build = (archetype: Archetype, history: GeneratedWorkout[] = generate(archetype)) =>
    templatesFor(archetype, history, EQUIPMENT_OF);

  /** The rotation day a template belongs to, from its name: "Day A" is 0. */
  const dayOf = (name: string) => name.charCodeAt(name.length - 1) - 65;

  it('gives every archetype one template per session of its rotation', () => {
    for (const archetype of ARCHETYPES) {
      expect(
        build(archetype).map((t) => t.name),
        archetype.key
      ).toEqual(['Day A', 'Day B', 'Day C']);
    }
  });

  it('prescribes only lifts the archetype’s equipment allows', () => {
    /*
     * The app's own rule — a lift is offered only if its catalogue equipment
     * tag is one the user owns (`availableExercises`, CLAUDE.md #5).
     *
     * FOUND IN REVIEW: this test used to check "is in the programme", with a
     * comment saying the history already respects the equipment. It did not:
     * the home-gym programme carried a machine-tagged lift, until ADR 0020's
     * 2026-09-11 amendment.
     */
    for (const archetype of ARCHETYPES) {
      const granted = new Set(archetype.equipment.map((g) => g.slug));
      for (const item of build(archetype).flatMap((t) => t.items)) {
        const tag = EQUIPMENT_OF.get(item.exerciseSlug);
        expect(granted, `${archetype.key}: ${item.exerciseSlug} needs ${tag}`).toContain(tag);
      }
    }
  });

  it('prescribes no programme lift outside its grant', () => {
    /*
     * Pinned rather than merely tolerated. This held `home-gym: chair-squat` —
     * a Smith-machine squat in a programme for dumbbells, bands and a floor —
     * until ADR 0020's 2026-09-11 amendment rebuilt the legs tree from lifts a
     * floor allows and the programme followed it. A NEW mismatch fails here
     * instead of vanishing from a template in silence.
     *
     * Asked of the programme rather than the templates, because `build` leaves
     * an out-of-grant lift out, and a template-level check could not see one.
     */
    expect(Object.fromEntries(ARCHETYPES.map((a) => [a.key, outOfGrant(a, EQUIPMENT_OF)]))).toEqual(
      {
        beginner: [],
        plateaued: [],
        returning: [],
        'home-gym': [],
        inconsistent: [],
      }
    );

    // And the lift that replaced it reaches his templates rather than being
    // filtered out with it.
    expect(build(byKey('home-gym')).flatMap((t) => t.items.map((i) => i.exerciseSlug))).toContain(
      'bodyweight-squat'
    );
  });

  it('copies each session’s lifts, sets and reps from the programme, never from the log', () => {
    /*
     * ADR 0010's case, and the reason templates come from the programme at all.
     * FOUND IN REVIEW: swapping sets and reps, prescribing one set, and dropping
     * a rep from every lift — the "1×5, 2×4" drift itself — all passed before
     * this test existed.
     */
    for (const archetype of ARCHETYPES) {
      const excluded = new Set(outOfGrant(archetype, EQUIPMENT_OF));
      for (const template of build(archetype)) {
        const day = dayOf(template.name);
        expect(
          template.items.map((i) => [i.exerciseSlug, i.setCount, i.reps]),
          `${archetype.key} ${template.name}`
        ).toEqual(
          archetype.programme
            .filter((e) => e.day === day && !excluded.has(e.exerciseSlug))
            .map((e) => [e.exerciseSlug, e.sets, e.reps])
        );
      }
    }
  });

  it('prescribes the heaviest set of the most recent session, not the heaviest ever', () => {
    /*
     * Hand-built so that the two differ: a 100 kg session, then a lighter week.
     * FOUND IN REVIEW: "above the starting load and at most the heaviest ever"
     * was a range, and "heaviest ever" sat inside it. The older, heavier session
     * comes FIRST in the array, so dropping the date sort fails here too.
     */
    const squat = (weightKg: number, setIndex: number) => ({
      exerciseSlug: 'barbell-full-squat',
      weightKg,
      reps: 5,
      rpe: 8,
      isWarmup: false,
      restSeconds: 180,
      setIndex,
    });
    const history: GeneratedWorkout[] = [
      { localDate: '2026-08-06', status: 'completed', notes: null, sets: [squat(100, 0)] },
      {
        localDate: '2026-08-20',
        status: 'completed',
        notes: null,
        sets: [squat(80, 0), squat(82.5, 1)],
      },
    ];
    const prescribed = build(byKey('beginner'), history)
      .flatMap((t) => t.items)
      .find((i) => i.exerciseSlug === 'barbell-full-squat')!;

    expect(prescribed.weightKg).toBe(82.5);
  });

  it('puts a generated lifter at their current load, above week one', () => {
    // The same rule on real data: twelve weeks in, the beginner is past 60 kg.
    const squat = build(byKey('beginner'))
      .flatMap((t) => t.items)
      .find((i) => i.exerciseSlug === 'barbell-full-squat')!;

    expect(squat.weightKg).toBeGreaterThan(60);
  });

  it('never prescribes above the home-gym dumbbell ceiling', () => {
    // THE case the plan names, on the seeded history. The clamp that makes it
    // hold for any history is proved by the fallback test below.
    const archetype = byKey('home-gym');
    for (const item of build(archetype).flatMap((t) => t.items)) {
      if (item.weightKg !== null) {
        expect(item.weightKg, item.exerciseSlug).toBeLessThanOrEqual(archetype.loadCeilingKg!);
      }
    }
  });

  it('falls back to the programme load for a lift never logged, clamped to the ceiling', () => {
    /*
     * FOUND IN REVIEW: this branch was reached for most beginner lifts in the
     * zero-load test and asserted for none of them, and the fallback was not
     * capped at all.
     */
    const home = byKey('home-gym');
    for (const item of build(home, []).flatMap((t) => t.items)) {
      const entry = home.programme.find((e) => e.exerciseSlug === item.exerciseSlug)!;
      expect(item.weightKg, item.exerciseSlug).toBe(entry.startingKg > 0 ? entry.startingKg : null);
    }

    // No shipped entry starts above the cap, so the clamp needs a synthetic one.
    const heavier: Archetype = {
      ...home,
      programme: home.programme.map((e) =>
        e.exerciseSlug === 'dumbbell-squat' ? { ...e, startingKg: 40 } : e
      ),
    };
    const squat = build(heavier, [])
      .flatMap((t) => t.items)
      .find((i) => i.exerciseSlug === 'dumbbell-squat')!;
    expect(squat.weightKg).toBe(30);
  });

  it('leaves every bodyweight lift without a load, rather than a load of zero', () => {
    // Derived from the programme rather than listed, so a new bodyweight lift is
    // covered without anyone adding its name here.
    for (const archetype of ARCHETYPES) {
      const bodyweight = new Set(
        archetype.programme.filter((e) => e.startingKg === 0).map((e) => e.exerciseSlug)
      );
      for (const item of build(archetype).flatMap((t) => t.items)) {
        if (bodyweight.has(item.exerciseSlug)) {
          expect(item.weightKg, `${archetype.key}: ${item.exerciseSlug}`).toBeNull();
        }
      }
    }
  });

  it('reads a logged load of zero as no load', () => {
    /*
     * FOUND BY BREAKING IT: the generator writes bodyweight sets as null, so
     * dropping the zero filter changed nothing. Hand-built, since the generator
     * never logs a 0. The authority is the templates migration's comment — a
     * null weight "is not the same claim as a load of zero" — not the schema,
     * which would accept 0.
     */
    const history: GeneratedWorkout[] = [
      {
        localDate: '2026-08-10',
        status: 'completed',
        notes: null,
        sets: [
          {
            exerciseSlug: 'pullups',
            weightKg: 0,
            reps: 6,
            rpe: 8,
            isWarmup: false,
            restSeconds: 90,
            setIndex: 0,
          },
        ],
      },
    ];
    const pullups = build(byKey('beginner'), history)
      .flatMap((t) => t.items)
      .find((i) => i.exerciseSlug === 'pullups')!;

    expect(pullups.weightKg).toBeNull();
  });

  it('maps to a draft createTemplate accepts, through the mapping the seeder runs', () => {
    /*
     * `toTemplateDraft` is what scripts/seed.ts calls, so this parses the real
     * mapping rather than a copy of it — FOUND IN REVIEW, the copy was all this
     * test used to check.
     */
    const idOf = (slug: string) =>
      `00000000-0000-4000-8000-${slug.length.toString(16).padStart(12, '0')}`;
    for (const archetype of ARCHETYPES) {
      for (const template of build(archetype)) {
        expect(
          () => templateDraftSchema.parse(toTemplateDraft(template, idOf)),
          `${archetype.key} ${template.name}`
        ).not.toThrow();
      }
    }

    // And a slug the catalogue lacks fails loudly, rather than writing a hole.
    const [first] = build(byKey('beginner'));
    expect(() => templateDraftSchema.parse(toTemplateDraft(first!, () => undefined))).toThrow();
  });

  it('emits no template for a session its equipment leaves empty', () => {
    /*
     * FOUND BY BREAKING IT: dropping the empty-template filter turned nothing
     * red, because no shipped rotation day loses every lift. createTemplate
     * refuses an empty template, so without the filter the seed would fail at
     * the write for an archetype whose whole session sits outside its grant.
     */
    const home = byKey('home-gym');
    const machineOnlyDayC: Archetype = {
      ...home,
      programme: [
        ...home.programme.filter((e) => e.day !== 2),
        { exerciseSlug: 'chair-squat', sets: 3, reps: 12, startingKg: 0, incrementKg: 0, day: 2 },
      ],
    };

    expect(build(machineOnlyDayC, []).map((t) => t.name)).toEqual(['Day A', 'Day B']);
  });
});
