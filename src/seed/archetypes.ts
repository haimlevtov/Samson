/**
 * Synthetic training histories.
 *
 * WHY this is pure and lives in src/ rather than inside the seed script: PLAN.md
 * calls the seeder critical-path work that looks disposable. Without plausible
 * history there is nothing to develop the phase 2 planner against, because real
 * history takes months. Keeping generation separate from the database writes
 * means each archetype's defining property — the plateau actually plateaus, the
 * capped dumbbells are never exceeded — is asserted by a test rather than
 * eyeballed once and assumed.
 */
import { addDays, startOfWeek } from '../metrics/dates';
import type { LocalDate, WorkoutStatus } from '../metrics/types';
import type { Sex } from '../diet/biometrics';
import { chance, jitter, mulberry32, randomInt, roundToPlate, type Rng } from './rng';
import type { TemplateDraft, TemplateItemDraft } from '../templates/schema';

export interface ProgrammeEntry {
  exerciseSlug: string;
  /** Working sets, excluding warmups. */
  sets: number;
  reps: number;
  startingKg: number;
  /** Added per progressed week. Zero for bodyweight movements. */
  incrementKg: number;
  /**
   * Which session of the programme's rotation this lift appears in: 0, 1 or 2.
   *
   * NOT a day of the week, and not an index into `daysPerWeek` — the previous
   * wording said "day of the training week", which invites `day: 3` for a
   * four-day archetype. Two archetypes do train four days a week; they cycle
   * back to session 0 on the fourth. `generateHistory` throws on anything
   * outside the rotation rather than dropping it silently.
   */
  day: number;
  /**
   * Draw this entry's randomness from the side stream instead of the shared one.
   *
   * WHY this exists, which is not "these sets are special": `generateHistory`
   * runs one seeded RNG through the whole history, so ANY entry that consumes a
   * draw shifts every draw after it — every load's jitter and every adherence
   * roll, for every session that follows, in every archetype sharing the
   * programme. The seed's contract is that the database is byte-identical on
   * every run, and thirty golden planner cases are built on those exact numbers.
   *
   * MEASURED when the bodyweight accessories were added 2026-09-08: drawing
   * from the shared stream moved the `returning` archetype's baseline weekly
   * tonnage enough that `tests/unit/planner-golden.test.ts` failed its most
   * important assertion — that a week matching a user's own recent training
   * passes every rule. Nothing was wrong with the accessories; the history had
   * simply been re-rolled underneath the fixture.
   *
   * WHY a side stream rather than "make the entry deterministic": a set draws
   * up to three times — rep drift (not on the first set), the RPE coin flip,
   * and rest seconds. Suppressing all three would give every accessory set in
   * twelve weeks the same RPE and the same rest, which is the "reads as fake on
   * sight" failure `roundToPlate` exists to avoid. The side stream keeps the
   * variety and spends it out of a different purse.
   *
   * AI-NOTE: set this on an entry ADDED after a golden baseline exists. An
   *          entry that legitimately belongs in the middle of a programme has
   *          to accept the re-baseline and the golden suite has to be re-read.
   */
  appended?: boolean;
}

export interface EquipmentGrant {
  slug: string;
  maxLoadKg?: number;
}

export interface Archetype {
  key: string;
  email: string;
  displayName: string;
  /** INVARIANT: history is generated in the user's local dates — CLAUDE.md #9. */
  timezone: string;
  /*
   * The four the diet advisor needs — ADR 0024, docs/specs/diet.md §1.
   *
   * WHY the seeder sets them at all: they are optional in the product and the
   * app worked for five phases without them, but a demo where the diet block
   * says "we need your height" is not a demo. Fixed values rather than drawn
   * from the RNG — a birth date is not a distribution, and inserting a draw
   * here would re-roll the entire downstream stream.
   *
   * INVARIANT: kilograms and centimetres — CLAUDE.md #8.
   */
  bodyweightKg: number;
  heightCm: number;
  /** A real date, so the age moves with the calendar like anybody else's. */
  birthDate: string;
  sex: Sex;
  summary: string;
  weeks: number;
  daysPerWeek: number;
  /** Probability a planned session is completed rather than skipped. */
  adherence: number;
  equipment: EquipmentGrant[];
  programme: ProgrammeEntry[];
  /**
   * A weekly LLM ceiling other than the column's default, written by the seeder
   * with the service role — ADR 0026's 2026-09-13 amendment. Set on the one
   * archetype the sign-in page fills in, and nowhere else.
   */
  weeklyBudgetUsd?: number;
  /** Inclusive, 1-indexed week range with no training at all. */
  layoff?: [number, number];
  /** Weeks after which load stops climbing. */
  plateauAfterWeek?: number;
  /** Hard ceiling on any single load, from capped equipment. */
  loadCeilingKg?: number;
}

export interface GeneratedSet {
  exerciseSlug: string;
  weightKg: number | null;
  reps: number;
  rpe: number | null;
  isWarmup: boolean;
  restSeconds: number;
  setIndex: number;
}

export interface GeneratedWorkout {
  localDate: LocalDate;
  status: WorkoutStatus;
  notes: string | null;
  sets: GeneratedSet[];
}

const BARBELL_PROGRAMME: ProgrammeEntry[] = [
  {
    exerciseSlug: 'barbell-full-squat',
    sets: 3,
    reps: 5,
    startingKg: 60,
    incrementKg: 2.5,
    day: 0,
  },
  {
    exerciseSlug: 'barbell-bench-press-medium-grip',
    sets: 3,
    reps: 5,
    startingKg: 45,
    incrementKg: 1.25,
    day: 0,
  },
  {
    exerciseSlug: 'bent-over-barbell-row',
    sets: 3,
    reps: 8,
    startingKg: 40,
    incrementKg: 1.25,
    day: 0,
  },
  { exerciseSlug: 'barbell-deadlift', sets: 2, reps: 5, startingKg: 80, incrementKg: 2.5, day: 1 },
  {
    exerciseSlug: 'standing-military-press',
    sets: 3,
    reps: 5,
    startingKg: 30,
    incrementKg: 1.25,
    day: 1,
  },
  { exerciseSlug: 'pullups', sets: 3, reps: 6, startingKg: 0, incrementKg: 0, day: 1 },
  { exerciseSlug: 'romanian-deadlift', sets: 3, reps: 8, startingKg: 50, incrementKg: 2.5, day: 2 },
  {
    exerciseSlug: 'incline-dumbbell-press',
    sets: 3,
    reps: 10,
    startingKg: 20,
    incrementKg: 1.25,
    day: 2,
  },
  { exerciseSlug: 'plank', sets: 3, reps: 1, startingKg: 0, incrementKg: 0, day: 2 },
  /*
   * Bodyweight accessories, added 2026-09-08 alongside the progression trees.
   *
   * WHY they belong in the programme rather than being bolted on by the seeder:
   * `generateHistory` is the single description of what an archetype did, and
   * the planner context, the golden suite and the database all read it. History
   * invented somewhere else would make those three disagree about the same
   * person.
   *
   * These are ordinary accessory prescriptions for a barbell lifter, written to
   * read like training rather than to clear a particular rung. `buildSets`
   * drifts a rep off later sets, so some sessions land below the number here —
   * which is realistic, and is why a tree may open one rung where the
   * prescription looks like it should open two.
   *
   * `appended` is not decoration: these arrived after the golden planner
   * fixtures existed. See the field's comment.
   */
  {
    exerciseSlug: 'inverted-row',
    sets: 3,
    reps: 14,
    startingKg: 0,
    incrementKg: 0,
    day: 2,
    appended: true,
  },
  {
    exerciseSlug: 'hanging-leg-raise',
    sets: 3,
    reps: 12,
    startingKg: 0,
    incrementKg: 0,
    day: 0,
    appended: true,
  },
  /*
   * The rung BELOW the hanging leg raise, added once the trees were seeded and
   * read back.
   *
   * A tree only unlocks downward: `core-pike` wants hanging leg raises, but its
   * parent `core-hanging` wants lying leg raises, and until someone had done
   * those the hanging ones above them were unreachable. The demo showed a
   * feature that looked broken rather than empty.
   *
   * The prescription is chosen so the archetype clears the rung — 16 where the
   * criterion asks 15, because `buildSets` drifts a rep off later sets. Saying
   * that plainly: this is content authored to demonstrate the trees, not an
   * independent observation that happens to satisfy them. It is also what a
   * real progression looks like, which is why it is defensible as history.
   */
  {
    exerciseSlug: 'flat-bench-lying-leg-raise',
    sets: 3,
    reps: 16,
    startingKg: 0,
    incrementKg: 0,
    day: 1,
    appended: true,
  },
];

const HOME_GYM_PROGRAMME: ProgrammeEntry[] = [
  { exerciseSlug: 'dumbbell-squat', sets: 4, reps: 12, startingKg: 18, incrementKg: 2, day: 0 },
  {
    exerciseSlug: 'incline-dumbbell-press',
    sets: 4,
    reps: 10,
    startingKg: 16,
    incrementKg: 2,
    day: 0,
  },
  {
    exerciseSlug: 'bent-over-two-dumbbell-row',
    sets: 4,
    reps: 10,
    startingKg: 20,
    incrementKg: 2,
    day: 1,
  },
  {
    exerciseSlug: 'arnold-dumbbell-press',
    sets: 3,
    reps: 10,
    startingKg: 12,
    incrementKg: 2,
    day: 1,
  },
  { exerciseSlug: 'pullups', sets: 3, reps: 8, startingKg: 0, incrementKg: 0, day: 1 },
  // Bodyweight accessories — see the note on BARBELL_PROGRAMME. A home-gym
  // trainee doing push-ups and air squats needs no justification beyond having
  // a floor.
  {
    exerciseSlug: 'pushups',
    sets: 3,
    reps: 16,
    startingKg: 0,
    incrementKg: 0,
    day: 0,
    appended: true,
  },
  // The legs tree's root, and the lift that opens its next rung: 3 × 20 in one
  // session. 21 because a later set drops a rep a quarter of the time. This was
  // `chair-squat` — a Smith-machine squat tagged `machine`, which this
  // archetype does not own — until ADR 0020's 2026-09-11 amendment. Same side
  // stream, same number of draws: a zero load draws nothing, and the count
  // depends on `sets` alone, which did not change — so no other entry's
  // numbers move.
  //
  // AI-NOTE: three numbers hold each other up. The lunge rung asks 3 × 20
  //          (supabase/migrations/20260911120000_legs_tree_on_the_floor.sql);
  //          this clears it every session, which src/seed/archetypes.test.ts
  //          holds; and his walking lunges below, at 3 × 12, stop short of the
  //          step-up's 3 × 16 on purpose — the climb tests/db/progression.test.ts
  //          pins. Change one and check the other two.
  {
    exerciseSlug: 'bodyweight-squat',
    sets: 3,
    reps: 21,
    startingKg: 0,
    incrementKg: 0,
    day: 2,
    appended: true,
  },
  // The rung below the push-up, for the same reason as the barbell lifter's
  // lying leg raise — see the note there. `push-decline` wants push-ups, but
  // `push-full` BELOW it wants incline push-ups (level 1 against level 2, and
  // the reader orders by level ascending), so without these the push chain
  // stopped at its root for everyone.
  {
    exerciseSlug: 'incline-push-up',
    sets: 3,
    reps: 14,
    startingKg: 0,
    incrementKg: 0,
    day: 1,
    appended: true,
  },
  {
    exerciseSlug: 'bodyweight-walking-lunge',
    sets: 3,
    reps: 12,
    startingKg: 0,
    incrementKg: 0,
    day: 2,
  },
  {
    exerciseSlug: 'alternate-hammer-curl',
    sets: 3,
    reps: 12,
    startingKg: 10,
    incrementKg: 2,
    day: 2,
  },
  { exerciseSlug: 'plank', sets: 3, reps: 1, startingKg: 0, incrementKg: 0, day: 2 },
];

/** The five cases PLAN.md names. */
/**
 * The archetype seeded WITHOUT an accepted plan — rework PR 8b.
 *
 * Its Coach tab shows the questionnaire instead of a block, which is the only way
 * that state is reachable on a seeded database. The inconsistent archetype is the
 * one it should be for a reason about the character rather than convenience:
 * somebody who misses half their sessions is the likeliest of the five not to
 * have got round to asking for a plan, and it exercises the state with the
 * thinnest history.
 *
 * WHY it lives here rather than in scripts/seed.ts, where it was: a test that
 * checks the key against this list has to import the list, and importing the
 * SCRIPT runs its `main()` — which called `process.exit(1)` in CI with no
 * environment. FOUND BY CI, and the test's own comment had claimed a dynamic
 * import avoided it. It does not; importing a module executes it.
 *
 * AI-NOTE: four accepted plan_runs rows, not five. A test or a demo script that
 *          assumes every seeded user has a plan will be wrong about this one.
 */
export const PLANLESS_ARCHETYPE = 'inconsistent';

/**
 * The sixth account, and it is not an Archetype — ADR 0032 §1.
 *
 * Every field on `Archetype` describes a synthetic history: weeks, adherence, a
 * programme, four biometrics. This user has none of those, and making them all
 * optional to fit it here would weaken a type the other five depend on.
 *
 * **It gets an auth user and nothing else.** No `users` row, no equipment, no
 * history, no plan, no XP — which is truer than a row full of nulls, and which
 * walks the one path nothing else does: the app rendering for somebody the
 * `users` table has never heard of. `currentUser` reads with `maybeSingle` and
 * defaults every field, so that path exists; until this account, nothing used it.
 *
 * AI-NOTE: do not "tidy" this by giving it a profile row with nulls. The absence
 *          IS the fixture — it is what proves onboarding works for a real
 *          sign-up, and a row would quietly test something easier.
 */
export const FRESH_ACCOUNT = {
  key: 'fresh',
  email: 'fresh@samson.test',
  summary: 'Nobody yet — the empty account a new user meets',
} as const;

/** The account the sign-in form is filled in with — ADR 0026's 2026-09-13 amendment. */
export const EVALUATOR_EMAIL = 'beginner@samson.test';

/**
 * That account's weekly LLM ceiling, so the lecturer can evaluate the app
 * without meeting the default one — ADR 0026's 2026-09-13 amendment.
 *
 * WHY the password stays the published one: every fixture's is, by design
 * (app/sign-in/page.tsx). So anyone with the URL can spend this much a week
 * through it — the risk the amendment records and the owner accepted.
 *
 * AI-NOTE: the hosted row was set by migration, 20260913090000 today. Changing
 *          the figure means a new migration too, and it must not find the
 *          account by address alone — the amendment says why and how to revert.
 *          tests/unit/invariants.test.ts reads the latest migration that sets a
 *          ceiling and fails unless it agrees with this and EVALUATOR_EMAIL.
 */
export const EVALUATOR_WEEKLY_BUDGET_USD = 2;

export const ARCHETYPES: Archetype[] = [
  {
    key: 'beginner',
    email: EVALUATOR_EMAIL,
    displayName: 'Noa (beginner)',
    timezone: 'Asia/Jerusalem',
    bodyweightKg: 62,
    heightCm: 166,
    birthDate: '2002-03-14',
    sex: 'female',
    summary: 'Twelve weeks of clean linear progression. Everything works.',
    weeks: 12,
    daysPerWeek: 3,
    adherence: 0.92,
    equipment: [
      { slug: 'barbell' },
      { slug: 'dumbbell' },
      { slug: 'bodyweight' },
      { slug: 'machine' },
      { slug: 'cable-machine' },
    ],
    programme: BARBELL_PROGRAMME,
    weeklyBudgetUsd: EVALUATOR_WEEKLY_BUDGET_USD,
  },
  {
    key: 'plateaued',
    email: 'plateaued@samson.test',
    displayName: 'Dan (plateaued)',
    timezone: 'Europe/Berlin',
    bodyweightKg: 84,
    heightCm: 180,
    birthDate: '1995-07-02',
    sex: 'male',
    summary: 'Trains hard and has not added weight in six weeks. The case the planner must notice.',
    weeks: 14,
    daysPerWeek: 4,
    adherence: 0.96,
    plateauAfterWeek: 6,
    equipment: [
      { slug: 'barbell' },
      { slug: 'dumbbell' },
      { slug: 'bodyweight' },
      { slug: 'cable-machine' },
    ],
    programme: BARBELL_PROGRAMME,
  },
  {
    key: 'returning',
    email: 'returning@samson.test',
    displayName: 'Maya (returning)',
    timezone: 'America/New_York',
    bodyweightKg: 68,
    heightCm: 170,
    birthDate: '1988-11-23',
    sex: 'female',
    summary:
      'Trained, vanished for five weeks, came back lighter. Load must not resume where it stopped.',
    weeks: 16,
    daysPerWeek: 3,
    adherence: 0.85,
    layoff: [5, 9],
    equipment: [{ slug: 'barbell' }, { slug: 'dumbbell' }, { slug: 'bodyweight' }],
    programme: BARBELL_PROGRAMME,
  },
  {
    key: 'home-gym',
    email: 'homegym@samson.test',
    displayName: 'Yossi (home gym)',
    timezone: 'Asia/Jerusalem',
    bodyweightKg: 92,
    heightCm: 176,
    birthDate: '1981-05-09',
    sex: 'male',
    summary: 'Dumbbells that stop at 30 kg, bands, and a pull-up bar. No barbell exists.',
    weeks: 12,
    daysPerWeek: 3,
    adherence: 0.88,
    // INVARIANT: equipment filtering happens in SQL — CLAUDE.md #5. This user is
    // the one that proves it: prescribe a barbell lift and it is plainly wrong.
    equipment: [
      { slug: 'dumbbell', maxLoadKg: 30 },
      { slug: 'resistance-band' },
      { slug: 'bodyweight' },
    ],
    loadCeilingKg: 30,
    programme: HOME_GYM_PROGRAMME,
  },
  {
    key: 'inconsistent',
    email: 'inconsistent@samson.test',
    displayName: 'Tom (inconsistent)',
    timezone: 'Europe/London',
    bodyweightKg: 78,
    heightCm: 183,
    birthDate: '1999-09-30',
    sex: 'male',
    summary:
      'Plans four days a week and manages about half. Adherence, not volume, is his problem.',
    weeks: 12,
    daysPerWeek: 4,
    adherence: 0.5,
    equipment: [{ slug: 'barbell' }, { slug: 'dumbbell' }, { slug: 'bodyweight' }],
    programme: BARBELL_PROGRAMME,
  },
];

/**
 * Progression earned, in weeks-equivalent.
 *
 * WHY this takes earned weeks rather than the calendar week: an inconsistent
 * lifter who trains half the time must not get stronger at the same rate as one
 * who turns up. Driving load off the calendar produced a user who reached a
 * heavier squat than the diligent beginner while completing 19 sessions to the
 * beginner's 32 — visibly wrong, and exactly the kind of implausibility that
 * would let a broken phase 2 planner look correct.
 *
 * AI-NOTE: `earned` advances only on a completed session. Anything that changes
 *          how sessions are generated must keep that true, or every archetype
 *          collapses back onto the same curve.
 */
function progressedWeeks(archetype: Archetype, earned: number): number {
  const { plateauAfterWeek } = archetype;
  if (plateauAfterWeek !== undefined) return Math.min(earned, plateauAfterWeek);
  return earned;
}

/**
 * What a layoff costs.
 *
 * WHY a multiplier applied once on return rather than a gentler per-week decay:
 * the drop has to exceed the 2.5 kg plate rounding or it disappears entirely.
 * At 0.75 the returning user came back 1.25 kg lighter, which rounded straight
 * back to where they stopped and made the archetype indistinguishable from the
 * beginner.
 */
const DETRAINING_RETENTION = 0.35;

/**
 * How many distinct sessions a programme rotates through.
 *
 * WHY this is not `archetype.daysPerWeek`: they are different numbers on
 * purpose, and two of the five archetypes prove it. A four-day archetype trains
 * on four calendar days — weekdays 0, 2, 4 and 6 — and cycles back to the first
 * programme day on the fourth, so `daysPerWeek` is 4 while the rotation is 3.
 *
 * AI-NOTE: a `ProgrammeEntry.day` is an index into THIS rotation, not a day of
 *          the week and not an index into `daysPerWeek`. Raising this means
 *          writing the sessions to fill it; every archetype shares the rotation.
 */
const PROGRAMME_DAYS = 3;

/**
 * Seeds the side stream `appended` entries draw from — see ProgrammeEntry.
 *
 * Any constant would do; it is fixed only so the database stays byte-identical.
 */
const ASIDE_SEED = 0x5ab1e;

function workingLoad(
  archetype: Archetype,
  entry: ProgrammeEntry,
  earned: number,
  rng: Rng
): number {
  if (entry.startingKg === 0) return 0; // bodyweight movement
  const progressed = entry.startingKg + entry.incrementKg * progressedWeeks(archetype, earned);
  const withNoise = jitter(rng, progressed, 0.02);
  const rounded = roundToPlate(withNoise);
  // INVARIANT: capped equipment is a hard ceiling, not a suggestion.
  return archetype.loadCeilingKg ? Math.min(rounded, archetype.loadCeilingKg) : rounded;
}

function buildSets(
  archetype: Archetype,
  entries: readonly ProgrammeEntry[],
  earned: number,
  rng: Rng,
  aside: Rng
): GeneratedSet[] {
  const sets: GeneratedSet[] = [];

  for (const entry of entries) {
    // INVARIANT: an appended entry touches `rng` nowhere — see ProgrammeEntry.
    //            Every draw below goes through `draw`, including the load, so
    //            marking a LOADED entry appended stays correct too.
    const draw = entry.appended ? aside : rng;
    const load = workingLoad(archetype, entry, earned, draw);
    let index = 0;

    // A warmup or two on loaded barbell work, as anyone actually training would.
    if (load >= 40) {
      for (const fraction of [0.5, 0.75]) {
        sets.push({
          exerciseSlug: entry.exerciseSlug,
          weightKg: roundToPlate(load * fraction),
          reps: entry.reps,
          rpe: null,
          isWarmup: true,
          restSeconds: 60,
          setIndex: index++,
        });
      }
    }

    for (let s = 0; s < entry.sets; s++) {
      // Reps drift down across a hard set or two; RPE drifts up.
      const dropped = s > 0 && chance(draw, 0.25) ? 1 : 0;
      sets.push({
        exerciseSlug: entry.exerciseSlug,
        weightKg: load === 0 ? null : load,
        reps: Math.max(1, entry.reps - dropped),
        rpe: Math.min(10, 7 + s * 0.5 + (chance(draw, 0.3) ? 0.5 : 0)),
        isWarmup: false,
        restSeconds: entry.reps <= 5 ? randomInt(draw, 150, 240) : randomInt(draw, 60, 120),
        setIndex: index++,
      });
    }
  }

  return sets;
}

/**
 * Refuses a programme that would silently omit prescribed work.
 *
 * WHY it is a whole-programme pass and not a check inside the day loop, where
 * the `appended` guard sits: the filter there is `e.day === day % PROGRAMME_DAYS`,
 * so an entry with `day: 3` is selected by no iteration at all. A check that runs
 * per SELECTED day is exactly the check that cannot see it. That is the shape of
 * every fault below — the work vanishes, and nothing is raised, logged or
 * rendered differently.
 *
 * WHY it is worth throwing over: `day: 3` is the natural thing to write for a
 * four-day archetype, and `daysPerWeek` genuinely is 4 for `plateaued` and
 * `inconsistent`. A vanished accessory is a progression-tree rung nobody can
 * ever open with nothing to say why — the failure the bodyweight accessories
 * were added to fix in the first place, reintroduced by a typo.
 *
 * FOUND IN REVIEW: the first version checked `day` alone, which is one member of
 * the class. The others are here because the class is the point.
 *
 * INVARIANT: the seeder refuses to produce history that silently omits
 *            prescribed work.
 *
 * AI-NOTE: raising PROGRAMME_DAYS means filling the new session in every
 *          programme — the check below enforces that rather than trusting it.
 */
export function validateProgramme(archetype: Archetype): void {
  const problems: string[] = [];

  /*
   * "Matches no session" rather than "outside the rotation": three different
   * conditions land here and only one is literally outside anything. `day: 1.5`
   * is inside the range and still selected by nothing, so the sentence has to be
   * true of all three.
   */
  for (const e of archetype.programme) {
    if (!Number.isInteger(e.day) || e.day < 0 || e.day >= PROGRAMME_DAYS) {
      problems.push(
        `${e.exerciseSlug} has day ${e.day}, which matches no session in the ` +
          `${PROGRAMME_DAYS}-day rotation — a programme day is a whole number from ` +
          `0 to ${PROGRAMME_DAYS - 1}, an index into the rotation rather than a day ` +
          'of the week or an index into daysPerWeek'
      );
    }

    /*
     * `sets: 0` is worse than it looks. For a bodyweight entry the loop below
     * runs zero times and the lift is simply absent; for a loaded one the warmup
     * block still fires, so the exercise appears in history having never been
     * worked — which reads as real training and is not.
     */
    if (!Number.isInteger(e.sets) || e.sets < 1) {
      problems.push(`${e.exerciseSlug} has sets ${e.sets}, so it would log no working set`);
    }

    // `reps: 0` is silently rewritten to 1 for working sets by the Math.max in
    // buildSets, while warmups keep the 0. Two different answers to one typo.
    if (!Number.isInteger(e.reps) || e.reps < 1) {
      problems.push(`${e.exerciseSlug} has reps ${e.reps}, which buildSets would quietly rewrite`);
    }

    /*
     * A negative load is caught eventually — by `weight_kg check (>= 0)` — but
     * only on a run that reaches the database with a service-role key. Every
     * offline consumer in `npm run verify` passes with it, so without this the
     * failure is invisible until seed time.
     */
    if (e.startingKg < 0) {
      problems.push(`${e.exerciseSlug} has a negative startingKg (${e.startingKg})`);
    }
  }

  /*
   * The inverse of the day check, and the more expensive omission of the two:
   * a rotation day with NO entries produces no workout row at all — not
   * completed, not skipped, and not a rest day either, because the rest loop
   * excludes training weekdays. The date disappears and the adherence
   * denominator shrinks with it.
   */
  for (let day = 0; day < PROGRAMME_DAYS; day++) {
    if (!archetype.programme.some((e) => e.day === day)) {
      problems.push(`session ${day} of the rotation has no entries, so that date would vanish`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`${archetype.key}: ${problems.join('; ')}.`);
  }
}

/**
 * Generates one archetype's history, ending on `endDate`.
 *
 * Sessions land on fixed weekdays so adherence has something to be measured
 * against: a missed day becomes a `skipped` workout with no sets, not an absence.
 * Without that row there is no denominator and adherence is unmeasurable.
 */
export function generateHistory(
  archetype: Archetype,
  endDate: LocalDate,
  rng: Rng
): GeneratedWorkout[] {
  const workouts: GeneratedWorkout[] = [];
  validateProgramme(archetype);

  /*
   * The side stream, for entries marked `appended`.
   *
   * Fixed seed, deliberately not derived from `rng`: deriving it would take a
   * draw, which is the exact thing the flag exists to avoid. It advances across
   * the whole history like the main stream, so an accessory's rest and RPE
   * still vary session to session — they are just no longer interleaved with
   * the draws the golden fixtures were built on.
   *
   * The consequence, stated because it is a real one: two archetypes sharing a
   * programme see the same accessory draws in the same order. Nothing reads
   * across archetypes, and RPE and rest on a set of push-ups are not what any
   * assertion is about.
   */
  const aside = mulberry32(ASIDE_SEED);

  // Anchor to a Monday so training weeks line up with the ISO weeks that weekly
  // tonnage and the phase 4 XP ceiling both use.
  const lastWeekStart = startOfWeek(endDate);
  const firstWeekStart = addDays(lastWeekStart, -7 * (archetype.weeks - 1));

  // Spread sessions across the week rather than stacking them consecutively.
  const weekdayForDay = [0, 2, 4, 6];

  // Progression earned by turning up, in weeks-equivalent. Advances only on a
  // completed session, which is what separates the archetypes from each other.
  let earned = 0;
  let returnedFromLayoff = false;

  for (let week = 1; week <= archetype.weeks; week++) {
    const weekStart = addDays(firstWeekStart, (week - 1) * 7);
    const onLayoff =
      archetype.layoff !== undefined && week >= archetype.layoff[0] && week <= archetype.layoff[1];

    if (archetype.layoff && week > archetype.layoff[1] && !returnedFromLayoff) {
      earned *= DETRAINING_RETENTION;
      returnedFromLayoff = true;
    }

    for (let day = 0; day < archetype.daysPerWeek; day++) {
      const localDate = addDays(weekStart, weekdayForDay[day % weekdayForDay.length]!);
      if (localDate > endDate) continue;

      if (onLayoff) {
        workouts.push({
          localDate,
          status: 'skipped',
          notes: week === archetype.layoff![0] && day === 0 ? 'Travelling for work.' : null,
          sets: [],
        });
        continue;
      }

      const entries = archetype.programme.filter((e) => e.day === day % PROGRAMME_DAYS);
      if (entries.length === 0) continue;

      /*
       * FOUND IN REVIEW: `appended` protects the shared stream only INSIDE
       * `buildSets`. Whether a day is trained at all is decided out here, and
       * it costs a draw — `chance(rng, adherence)` below — and advances
       * `earned`, which drives every later working load. So an appended entry
       * that is the ONLY entry on its day turns a skipped day into a session
       * and re-rolls the history anyway, which is the exact re-baseline the
       * flag exists to prevent. Measured while this was being written: one such
       * entry changed 21 of the beginner's 68 rows, loads included.
       *
       * INVARIANT: an appended entry never decides that a day happens.
       */
      if (entries.every((e) => e.appended === true)) {
        throw new Error(
          `${archetype.key}: day ${day % PROGRAMME_DAYS} holds only appended entries ` +
            `(${entries.map((e) => e.exerciseSlug).join(', ')}). ` +
            'An appended entry must share its day with a non-appended one, or it ' +
            'creates the session it is supposed to be invisible to.'
        );
      }

      if (!chance(rng, archetype.adherence)) {
        workouts.push({ localDate, status: 'skipped', notes: null, sets: [] });
        continue;
      }

      workouts.push({
        localDate,
        status: 'completed',
        notes: null,
        sets: buildSets(archetype, entries, earned, rng, aside),
      });
      earned += 1 / archetype.daysPerWeek;
    }

    /*
     * INVARIANT: a scheduled rest day maintains a streak — CLAUDE.md #4.
     *
     * AI-NOTE: one rest day per date per user — `workouts_one_rest_a_day`,
     *          ADR 0034. The loop below writes each non-training day once.
     *
     * WHY every non-training day, and not one token Saturday: a programme is
     * seven days long, and the days it does not train are rest days rather than
     * gaps. That is the whole content of "rest maintains a streak".
     *
     * Emitting a single rest day a week made the first consistency achievement
     * unreachable from a fresh `npm run seed`: a three-day archetype covered
     * offsets 0, 2, 4 and 5, so at most four of seven days were kept and
     * "Seven for Seven" could not fire for anyone. It was verified during phase
     * 4 by adding two rest days to the dev database BY HAND, which is a sign
     * the fixture was wrong rather than the achievement.
     *
     * A day the archetype was scheduled to train and missed stays 'skipped'.
     * Only unscheduled days become rest, so a low-adherence archetype still
     * breaks its streak exactly as it should.
     */
    if (!onLayoff) {
      const trains = new Set(
        Array.from(
          { length: archetype.daysPerWeek },
          (_, day) => weekdayForDay[day % weekdayForDay.length]!
        )
      );

      for (let offset = 0; offset < 7; offset++) {
        if (trains.has(offset)) continue;
        workouts.push({
          localDate: addDays(weekStart, offset),
          status: 'rest',
          notes: null,
          sets: [],
        });
      }
    }
  }

  return workouts.filter((w) => w.localDate <= endDate);
}

/**
 * One prescribed set group, before the seeder resolves its slug to an id.
 *
 * Derived from the Zod-inferred draft rather than written out beside it —
 * CLAUDE.md: types come from the schema — so a bound or a nullability change in
 * src/templates/schema.ts reaches the seed without anyone remembering to.
 */
export type SeedTemplateItem = Pick<TemplateItemDraft, 'setCount' | 'reps' | 'weightKg'> & {
  exerciseSlug: string;
};

export interface SeedTemplate {
  name: string;
  items: SeedTemplateItem[];
}

/** Catalogue equipment tag by exercise slug, from `data/exercises.snapshot.json`. */
export type EquipmentOf = ReadonlyMap<string, string>;

/**
 * Programme lifts this archetype's equipment does not allow.
 *
 * The app offers a user only lifts whose catalogue equipment tag they own —
 * `availableExercises` in src/db/exercises.ts, CLAUDE.md #5 — and until this
 * nothing held the programmes to that rule. FOUND IN REVIEW: the home-gym
 * programme carried `chair-squat`, which the catalogue tags `machine`, so that
 * archetype's history logged a lift the app would never let him pick. Fixed by
 * ADR 0020's 2026-09-11 amendment — the legs tree changed, and the programme
 * with it — so every archetype's list is empty now.
 *
 * AI-NOTE: this function keeps an out-of-grant lift out of a template, and
 *          `src/seed/archetypes.test.ts` pins every list at empty — the pin is
 *          what makes a NEW mismatch fail loudly instead of vanishing from a
 *          template in silence.
 */
export function outOfGrant(archetype: Archetype, equipmentOf: EquipmentOf): string[] {
  const granted = new Set(archetype.equipment.map((grant) => grant.slug));
  return archetype.programme
    .map((entry) => entry.exerciseSlug)
    .filter((slug) => !granted.has(equipmentOf.get(slug) ?? ''));
}

/**
 * One workout template per session of the rotation, built from the programme.
 *
 * WHY the programme and not `templateFromSession()`: that function turns what
 * was DONE into a template, and ADR 0010's load-bearing rule is that a
 * prescription and a record are different things. `buildSets` drifts a rep off
 * later sets, so a template saved from a logged session would prescribe
 * "1×5, 2×4" because that is what happened. The programme is the archetype's
 * prescription, and a template is a prescription — so lifts, sets and reps are
 * copied from it and never from the log.
 *
 * WHY the load comes from the history anyway: a template prescribing
 * `startingKg` would hand someone twelve weeks in their week-one loads. So the
 * weight is the heaviest working set of the most recent session that had the
 * lift in it — where that lifter is now — and never above the archetype's
 * equipment ceiling.
 *
 * Lifts outside the archetype's equipment are left out (`outOfGrant`), and a
 * session left with nothing in it is not emitted, because createTemplate
 * refuses an empty template. Rest is deliberately absent: the programme never
 * specifies one, and the session grid falls back to its own default.
 *
 * Pure, so `src/seed/archetypes.test.ts` can hold all of this offline.
 */
export function templatesFor(
  archetype: Archetype,
  history: readonly GeneratedWorkout[],
  equipmentOf: EquipmentOf
): SeedTemplate[] {
  const excluded = new Set(outOfGrant(archetype, equipmentOf));
  const ceiling = archetype.loadCeilingKg;
  // INVARIANT: capped equipment is a hard ceiling — CLAUDE.md #5 — on every
  //            path, including a history that generateHistory did not make.
  const capped = (kg: number): number => (ceiling === undefined ? kg : Math.min(kg, ceiling));

  /*
   * Newest session first, by date. The generator's own output would come out
   * the same without the sort — rest days carry no sets, so where they sit in
   * the array changes nothing — but this function takes any history, and a
   * caller's array order is not a promise about dates.
   */
  const newestFirst = [...history].sort((a, b) => (a.localDate < b.localDate ? 1 : -1));

  const latestLoad = new Map<string, number | null>();
  for (const workout of newestFirst) {
    const working = workout.sets.filter((set) => !set.isWarmup);
    for (const slug of new Set(working.map((set) => set.exerciseSlug))) {
      if (latestLoad.has(slug)) continue;
      /*
       * A logged zero is read as no load. The schema would accept 0, but the
       * templates migration says what null means — "not the same claim as a
       * load of zero" — and `plottable` in src/metrics/progression.ts draws the
       * same line. A bodyweight set has no external load to prescribe.
       */
      const loads = working
        .filter((set) => set.exerciseSlug === slug && set.weightKg !== null && set.weightKg > 0)
        .map((set) => set.weightKg as number);
      latestLoad.set(slug, loads.length === 0 ? null : Math.max(...loads));
    }
  }

  return Array.from({ length: PROGRAMME_DAYS }, (_, day) => ({
    // "Day A" rather than a descriptive name: the Workout tab's card already
    // lists the lifts under it, which is what makes a template name readable.
    name: `Day ${String.fromCharCode(65 + day)}`,
    items: archetype.programme
      .filter((entry) => entry.day === day && !excluded.has(entry.exerciseSlug))
      .map((entry): SeedTemplateItem => {
        const logged = latestLoad.get(entry.exerciseSlug);
        /*
         * `undefined` is a lift the history never reached. The programme's own
         * starting load is the honest fallback — and a startingKg of zero is how
         * this file writes a bodyweight lift, so it becomes null for the same
         * reason a logged zero does.
         */
        const fallback = entry.startingKg > 0 ? capped(entry.startingKg) : null;
        return {
          exerciseSlug: entry.exerciseSlug,
          setCount: entry.sets,
          reps: entry.reps,
          weightKg: logged === undefined ? fallback : logged === null ? null : capped(logged),
        };
      }),
  })).filter((template) => template.items.length > 0);
}

/**
 * The draft `createTemplate` takes, from a seeded template.
 *
 * Shared by the seeder and its test, so the mapping the seed actually runs is
 * the one the test parses. FOUND IN REVIEW: the test rebuilt the draft by hand,
 * which meant the seeder's own copy was never checked offline.
 *
 * `exerciseId` is whatever `idOf` returns, with no fallback. A slug the
 * catalogue lacks becomes an empty string, which fails `z.uuid()` inside
 * createTemplate loudly rather than writing a template with a hole in it — and
 * the "prescribes only exercises the committed catalogue has" test is what
 * keeps that from happening at all.
 */
export function toTemplateDraft(
  template: SeedTemplate,
  idOf: (slug: string) => string | undefined
): TemplateDraft {
  return {
    name: template.name,
    source: 'user',
    notes: null,
    items: template.items.map((item) => ({
      exerciseId: idOf(item.exerciseSlug) ?? '',
      setCount: item.setCount,
      reps: item.reps,
      weightKg: item.weightKg,
      rpe: null,
      restSeconds: null,
    })),
  };
}
