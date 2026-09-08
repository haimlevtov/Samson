/**
 * The achievement set, measured against a real Postgres.
 *
 * WHY these are database tests and not unit tests: an achievement in this
 * project is a ROW whose unlock condition is SQL text — CLAUDE.md #7 and ADR
 * 0009. There is no TypeScript to unit-test. The predicate either behaves
 * against real data or it does not, and `evaluate_achievements` swallows a
 * broken one silently, so a predicate with a typo simply never fires and
 * nothing anywhere says why. These tests are the only thing that would notice.
 *
 * Every case follows .claude/skills/add-achievement/SKILL.md §4: a fixture that
 * meets the condition, a NEAR MISS that does not, and — where it is the point —
 * proof that a re-run does not unlock it twice.
 *
 * INVARIANT: the service role creates fixtures; every assertion runs through a
 *            user-scoped client — the same split as tests/db/rls.test.ts.
 *
 * AI-NOTE: each test owns its own fixture user. Sharing one between cases here
 *          is not a tidiness question — every predicate reads the user's WHOLE
 *          history, so one test's sets change another test's answer. Measured
 *          on this project before: three of nine tests passed only because of
 *          data a different test had written.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers';
import { MAX_PLAUSIBLE_REPS, MAX_PLAUSIBLE_WEIGHT_KG } from '../../src/gamification/plausibility';

const admin = adminClient();

/** Every tier `achievements_tier_check` allows, from the phase-0 schema. */
const TIERS = [
  'volume',
  'consistency',
  'comeback',
  'pr',
  'recovery',
  'variety',
  'hidden',
  'calendar',
] as const;

const created: TestUser[] = [];

afterAll(async () => {
  await Promise.all(created.map(deleteTestUser));
}, 120_000);

async function newUser(label: string, timezone = 'UTC'): Promise<TestUser> {
  const user = await createTestUser(label);
  created.push(user);
  if (timezone !== 'UTC') {
    const { error } = await admin.from('users').update({ timezone }).eq('user_id', user.id);
    if (error) throw new Error(`setting ${label} timezone: ${error.message}`);
  }
  return user;
}

interface WorkoutFields {
  localDate: string;
  status?: 'planned' | 'in_progress' | 'completed' | 'skipped' | 'rest';
  startedAt?: string;
}

function workoutRow(user: TestUser, fields: WorkoutFields) {
  return {
    user_id: user.id,
    local_date: fields.localDate,
    status: fields.status ?? 'completed',
    started_at: fields.startedAt ?? null,
  };
}

async function addWorkout(user: TestUser, fields: WorkoutFields): Promise<string> {
  const { data, error } = await admin
    .from('workouts')
    .insert(workoutRow(user, fields))
    .select('id')
    .single();

  if (error || !data) throw new Error(`inserting workout: ${error?.message}`);
  return data.id;
}

/** One round trip for a run of days. Nineteen sequential inserts against the
 *  hosted project is most of a test's time budget spent on latency. */
async function addWorkouts(user: TestUser, days: readonly WorkoutFields[]): Promise<void> {
  const { error } = await admin.from('workouts').insert(days.map((d) => workoutRow(user, d)));
  if (error) throw new Error(`inserting workouts: ${error.message}`);
}

interface SetFields {
  exerciseId: string;
  weightKg: number;
  reps: number;
  count: number;
  /** Where to start `set_index`, which is unique per (workout, exercise). */
  from?: number;
}

async function addSets(user: TestUser, workoutId: string, fields: SetFields): Promise<void> {
  const from = fields.from ?? 0;
  const rows = Array.from({ length: fields.count }, (_, n) => ({
    user_id: user.id,
    workout_id: workoutId,
    exercise_id: fields.exerciseId,
    set_index: from + n,
    weight_kg: fields.weightKg,
    reps: fields.reps,
    is_warmup: false,
  }));

  const { error } = await admin.from('sets').insert(rows);
  if (error) throw new Error(`inserting sets: ${error.message}`);
}

/**
 * The real unlock path: a completed workout, and the user's own session asking
 * for its award. `evaluate_achievements` is deliberately not granted to
 * `authenticated` — ADR 0009 — so there is no shortcut, and going the long way
 * is what makes these tests measure what a user would actually get.
 */
async function awardFor(user: TestUser, localDate: string): Promise<string[]> {
  const workoutId = await addWorkout(user, { localDate, status: 'completed' });
  const { data, error } = await user.client.rpc('award_session_xp', { p_workout_id: workoutId });
  if (error) throw new Error(`awarding: ${error.message}`);
  return (data as { unlocked?: string[] } | null)?.unlocked ?? [];
}

/** Slugs this user holds, through the definer function the app reads. */
async function heldBy(user: TestUser): Promise<string[]> {
  const { data, error } = await user.client.rpc('unlocked_achievements');
  if (error) throw new Error(`reading unlocked: ${error.message}`);
  return (data ?? []).map((row) => row.slug);
}

/** Exercise ids for `count` distinct movement patterns, from shared catalogue rows. */
async function exercisesAcrossPatterns(count: number): Promise<string[]> {
  const { data, error } = await admin
    .from('exercises')
    .select('id, movement_pattern')
    .is('user_id', null)
    .not('movement_pattern', 'is', null)
    .limit(1000);

  if (error) throw new Error(`reading catalogue: ${error.message}`);

  const byPattern = new Map<string, string>();
  for (const row of data ?? []) {
    const pattern = row.movement_pattern;
    if (pattern !== null && !byPattern.has(pattern)) byPattern.set(pattern, row.id);
  }

  const ids = [...byPattern.values()].slice(0, count);
  if (ids.length < count) {
    throw new Error(`catalogue has ${ids.length} movement patterns, needed ${count}`);
  }
  return ids;
}

async function anyExercise(): Promise<string> {
  const [id] = await exercisesAcrossPatterns(1);
  return id!;
}

// ---------------------------------------------------------------------------
// The set as a whole
// ---------------------------------------------------------------------------

describe('the shipped achievement set', () => {
  it('has at least one system row in every tier the schema allows', async () => {
    // WHY assert against the CHECK's own list rather than a hand-written count:
    // a tier added to the constraint with no row behind it is the exact fault
    // this PR exists to fix, and this fails the moment it happens again.
    const { data, error } = await admin.from('achievements').select('tier').is('user_id', null);

    expect(error).toBeNull();
    const present = new Set((data ?? []).map((row) => row.tier));
    expect([...TIERS].filter((tier) => !present.has(tier))).toEqual([]);
  });

  it('keeps the volume predicate pinned to the plausibility constants', async () => {
    /*
     * The volume badge's SQL repeats MAX_PLAUSIBLE_WEIGHT_KG and
     * MAX_PLAUSIBLE_REPS because a predicate cannot import TypeScript. This is
     * the join between the two copies: change either constant without changing
     * the migration and this fails, which is the only warning there would be.
     */
    const { data, error } = await admin
      .from('achievements')
      .select('predicate')
      .eq('slug', 'hundred-tonnes')
      .is('user_id', null)
      .single();

    expect(error).toBeNull();
    expect(data!.predicate).toContain(`<= ${MAX_PLAUSIBLE_WEIGHT_KG}`);
    expect(data!.predicate).toContain(`<= ${MAX_PLAUSIBLE_REPS}`);
  });

  it('never lets a client read a hidden definition', async () => {
    const user = await newUser('ach-hidden-read');

    // The user's own session, asking directly for the thing the policy hides.
    const { data, error } = await user.client.from('achievements').select('slug, hidden');

    expect(error).toBeNull();
    expect((data ?? []).filter((row) => row.hidden)).toEqual([]);

    // And there is something to hide, so the assertion above is not vacuous.
    const { count } = await admin
      .from('achievements')
      .select('slug', { count: 'exact', head: true })
      .eq('hidden', true);
    expect(count ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Hidden — held versus locked
// ---------------------------------------------------------------------------

describe('a hidden badge', () => {
  it('reaches the person who earned it, and no one else', async () => {
    const owner = await newUser('ach-groundhog');
    const stranger = await newUser('ach-stranger');
    const exerciseId = await anyExercise();

    // groundhog-set wants twenty sets of one lift at one weight for one rep
    // count. Nineteen first, to prove the boundary is where it says it is.
    const nearMiss = await addWorkout(owner, { localDate: '2026-04-06' });
    await addSets(owner, nearMiss, { exerciseId, weightKg: 60, reps: 8, count: 19 });

    expect(await awardFor(owner, '2026-04-06')).not.toContain('groundhog-set');

    const twentieth = await addWorkout(owner, { localDate: '2026-04-07' });
    await addSets(owner, twentieth, { exerciseId, weightKg: 60, reps: 8, count: 1 });

    expect(await awardFor(owner, '2026-04-07')).toContain('groundhog-set');

    // The definition comes back to its holder in full — name, description, and
    // the flag the surface marks it with.
    const { data } = await owner.client.rpc('unlocked_achievements');
    const held = (data ?? []).find((row) => row.slug === 'groundhog-set');
    expect(held?.name).toBe('Groundhog Set');
    expect(held?.description.length ?? 0).toBeGreaterThan(0);
    expect(held?.hidden).toBe(true);

    // Nobody else's function call returns it. There is no parameter to pass, so
    // this is the only way to ask.
    expect(await heldBy(stranger)).not.toContain('groundhog-set');
  });

  it('fires exactly once, however many times the award is asked for', async () => {
    const user = await newUser('ach-once');
    const exerciseId = await anyExercise();

    const workoutId = await addWorkout(user, { localDate: '2026-04-10' });
    await addSets(user, workoutId, { exerciseId, weightKg: 40, reps: 12, count: 20 });

    expect(await awardFor(user, '2026-04-10')).toContain('groundhog-set');

    // A second session, later. The condition is still met and the badge is
    // already held, so it must not be reported or recorded again.
    expect(await awardFor(user, '2026-04-11')).not.toContain('groundhog-set');

    const { count } = await admin
      .from('achievement_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    expect(count).toBe(1);
  });

  it("is earned in the user's own timezone, not the server's", async () => {
    // before-the-birds asks whether the session began before 05:00 LOCAL.
    // 08:30Z in April is 04:30 in New York and 10:30 in Berlin, so one instant
    // is an answer of yes for one user and no for the other.
    const earlyRiser = await newUser('ach-early', 'America/New_York');
    const normalHours = await newUser('ach-normal', 'Europe/Berlin');

    await addWorkout(earlyRiser, {
      localDate: '2026-04-14',
      status: 'completed',
      startedAt: '2026-04-14T08:30:00Z', // 04:30 in New York
    });
    await addWorkout(normalHours, {
      localDate: '2026-04-14',
      status: 'completed',
      startedAt: '2026-04-14T08:30:00Z', // 10:30 in Berlin
    });

    expect(await awardFor(earlyRiser, '2026-04-15')).toContain('before-the-birds');
    expect(await awardFor(normalHours, '2026-04-15')).not.toContain('before-the-birds');
  });
});

// ---------------------------------------------------------------------------
// Calendar — the acceptance criterion
// ---------------------------------------------------------------------------

describe('a calendar achievement', () => {
  it('fires on the local date either side of the date line', async () => {
    /*
     * PLAN.md phase 5: "Calendar achievements fire on the correct local date
     * for a user in a non-server timezone."
     *
     * THE PAIR IS THE TEST. Kiritimati is UTC+14 and Niue UTC-11, so between
     * them there is a full day of disagreement about what the date is:
     *
     *   Kiritimati  2025-12-31T10:30Z  is  2026-01-01 00:30 local  -> fires
     *   Niue        2026-01-01T10:00Z  is  2025-12-31 23:00 local  -> does not
     *
     * A predicate reading the SERVER date inverts both answers and still
     * passes either assertion alone. Only a local-date predicate passes both,
     * which is why neither user is here without the other.
     */
    const aheadOfUtc = await newUser('ach-kiritimati', 'Pacific/Kiritimati');
    const behindUtc = await newUser('ach-niue', 'Pacific/Niue');

    await addWorkout(aheadOfUtc, {
      localDate: '2026-01-01',
      status: 'completed',
      startedAt: '2025-12-31T10:30:00Z',
    });
    await addWorkout(behindUtc, {
      localDate: '2025-12-31',
      status: 'completed',
      startedAt: '2026-01-01T10:00:00Z',
    });

    expect(await awardFor(aheadOfUtc, '2026-01-02')).toContain('new-years-day');
    expect(await awardFor(behindUtc, '2026-01-02')).not.toContain('new-years-day');
  });

  it('marks an anniversary and not the day after it', async () => {
    const user = await newUser('ach-anniversary');

    await addWorkout(user, { localDate: '2025-03-10' });
    // One year and one day. Same season, wrong date.
    await addWorkout(user, { localDate: '2026-03-11' });
    expect(await awardFor(user, '2026-03-12')).not.toContain('one-year-on');

    await addWorkout(user, { localDate: '2026-03-10' });
    expect(await awardFor(user, '2026-03-13')).toContain('one-year-on');
  });
});

// ---------------------------------------------------------------------------
// One case per remaining tier, each with its near miss
// ---------------------------------------------------------------------------

describe('the boundary of each remaining tier', () => {
  it('consistency: twenty kept days out of twenty-eight, not nineteen', async () => {
    const user = await newUser('ach-consistency');

    // Nineteen kept days, rest days among them because a rest day is kept.
    await addWorkouts(
      user,
      Array.from({ length: 19 }, (_, n) => ({
        localDate: `2026-05-${String(n + 1).padStart(2, '0')}`,
        status: (n % 3 === 2 ? 'rest' : 'completed') as WorkoutFields['status'],
      }))
    );

    // WHY the near miss re-uses 05-19 rather than taking the next date: awardFor
    // logs a completed workout before it evaluates, so asking on a NEW day would
    // hand the user the twentieth day and then check whether they had twenty.
    // The predicate counts DISTINCT local dates, so a second session on a day
    // already kept moves nothing.
    expect(await awardFor(user, '2026-05-19')).not.toContain('twenty-of-twenty-eight');

    expect(await awardFor(user, '2026-05-20')).toContain('twenty-of-twenty-eight');
  });

  it('volume: a hundred tonnes, and an implausible set that does not help', async () => {
    const user = await newUser('ach-volume');
    const exerciseId = await anyExercise();

    // Nine groups of ten sets at 101..109 kg for ten reps: 94,500 kg, which is
    // under the line. Weights vary so this cannot also trip groundhog-set and
    // leave the assertion ambiguous about which badge did not fire.
    const workoutId = await addWorkout(user, { localDate: '2026-06-01' });
    for (let n = 0; n < 9; n += 1) {
      await addSets(user, workoutId, {
        exerciseId,
        weightKg: 101 + n,
        reps: 10,
        count: 10,
        from: n * 10,
      });
    }

    // Two sets nobody lifted, one past each bound. Either alone would clear the
    // badge if the predicate counted it: 900 x 100 is 90,000 kg and 200 x 150 is
    // 30,000, against the 5,500 actually missing.
    await addSets(user, workoutId, {
      exerciseId,
      weightKg: MAX_PLAUSIBLE_WEIGHT_KG + 400,
      reps: MAX_PLAUSIBLE_REPS,
      count: 1,
      from: 200,
    });
    await addSets(user, workoutId, {
      exerciseId,
      weightKg: 200,
      reps: MAX_PLAUSIBLE_REPS + 50,
      count: 1,
      from: 201,
    });

    expect(await awardFor(user, '2026-06-01')).not.toContain('hundred-tonnes');

    // Now enough real work to cross the line: 12,000 kg more.
    const second = await addWorkout(user, { localDate: '2026-06-02' });
    await addSets(user, second, { exerciseId, weightKg: 120, reps: 10, count: 10 });
    expect(await awardFor(user, '2026-06-02')).toContain('hundred-tonnes');
  });

  it('pr: twenty percent over the first working set, not nineteen', async () => {
    const user = await newUser('ach-pr');
    const exerciseId = await anyExercise();

    const first = await addWorkout(user, { localDate: '2026-06-10' });
    await addSets(user, first, { exerciseId, weightKg: 100, reps: 5, count: 5 });
    // 119 kg is 19% up on the first set, over the six-set floor.
    await addSets(user, first, { exerciseId, weightKg: 119, reps: 5, count: 1, from: 5 });
    expect(await awardFor(user, '2026-06-10')).not.toContain('twenty-percent-up');

    const second = await addWorkout(user, { localDate: '2026-06-12' });
    await addSets(user, second, { exerciseId, weightKg: 120, reps: 5, count: 1 });
    expect(await awardFor(user, '2026-06-12')).toContain('twenty-percent-up');
  });

  it('comeback: twenty-one days away, not twenty', async () => {
    const user = await newUser('ach-comeback');

    await addWorkout(user, { localDate: '2026-07-01' });
    await addWorkout(user, { localDate: '2026-07-21' }); // twenty days
    expect(await awardFor(user, '2026-07-22')).not.toContain('three-weeks-away');

    // A gap of exactly twenty-one, after the run above.
    await addWorkout(user, { localDate: '2026-08-12' });
    expect(await awardFor(user, '2026-08-13')).toContain('three-weeks-away');
  });

  it('recovery: ten rest days, not nine', async () => {
    const user = await newUser('ach-recovery');

    await addWorkouts(
      user,
      Array.from({ length: 9 }, (_, n) => ({
        localDate: `2026-09-${String(n + 1).padStart(2, '0')}`,
        status: 'rest' as const,
      }))
    );
    expect(await awardFor(user, '2026-09-10')).not.toContain('ten-rest-days');

    await addWorkout(user, { localDate: '2026-09-11', status: 'rest' });
    expect(await awardFor(user, '2026-09-12')).toContain('ten-rest-days');
  });

  it('variety: five movement patterns, not four', async () => {
    const user = await newUser('ach-variety');
    const exercises = await exercisesAcrossPatterns(5);

    const workoutId = await addWorkout(user, { localDate: '2026-10-01' });
    for (const [index, exerciseId] of exercises.slice(0, 4).entries()) {
      await addSets(user, workoutId, { exerciseId, weightKg: 20 + index, reps: 10, count: 1 });
    }
    expect(await awardFor(user, '2026-10-01')).not.toContain('five-patterns');

    const second = await addWorkout(user, { localDate: '2026-10-02' });
    await addSets(user, second, { exerciseId: exercises[4]!, weightKg: 25, reps: 10, count: 1 });
    expect(await awardFor(user, '2026-10-02')).toContain('five-patterns');
  });
});
