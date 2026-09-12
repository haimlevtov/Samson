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
 *          history, so one test's sets change another test's answer. The
 *          leaderboard suite in the previous phase was measured doing exactly
 *          that: neutering its per-test setup failed a third of its cases,
 *          which had been passing on data a different test had written.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { adminClient, anonClient, createTestUser, deleteTestUsers, type TestUser } from './helpers';
import { MAX_PLAUSIBLE_REPS, MAX_PLAUSIBLE_WEIGHT_KG } from '../../src/gamification/plausibility';
import { loadBadgeCatalogue } from '../../src/db/gamification';

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
  await deleteTestUsers(...created);
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

/**
 * One round trip for a run of days, returning their ids in the order given.
 * Nineteen sequential inserts against the hosted project is most of a test's
 * time budget spent on latency.
 */
async function addWorkouts(user: TestUser, days: readonly WorkoutFields[]): Promise<string[]> {
  const { data, error } = await admin
    .from('workouts')
    .insert(days.map((d) => workoutRow(user, d)))
    .select('id');

  if (error || !data) throw new Error(`inserting workouts: ${error?.message}`);
  return data.map((row) => row.id);
}

/** `2026-06-07` for 7. Keeps a thirty-day fixture from being thirty literals. */
const june = (day: number) => `2026-06-${String(day).padStart(2, '0')}`;

interface SetFields {
  exerciseId: string;
  weightKg: number;
  reps: number;
  count: number;
  /** Where to start `set_index`, which is unique per (workout, exercise). */
  from?: number;
}

function setRows(user: TestUser, workoutId: string, fields: SetFields) {
  const from = fields.from ?? 0;
  return Array.from({ length: fields.count }, (_, n) => ({
    user_id: user.id,
    workout_id: workoutId,
    exercise_id: fields.exerciseId,
    set_index: from + n,
    weight_kg: fields.weightKg,
    reps: fields.reps,
    is_warmup: false,
  }));
}

async function addSets(user: TestUser, workoutId: string, fields: SetFields): Promise<void> {
  await addSetGroups(user, workoutId, [fields]);
}

/** Several groups, one round trip. The `from` offsets keep set_index unique. */
async function addSetGroups(
  user: TestUser,
  workoutId: string,
  groups: readonly SetFields[]
): Promise<void> {
  const rows = groups.flatMap((group) => setRows(user, workoutId, group));
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

/** System achievement ids by slug, read once. */
const achievementIds = (async () => {
  const { data, error } = await admin.from('achievements').select('id, slug').is('user_id', null);
  if (error) throw new Error(`reading achievements: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.slug, row.id]));
})();

/**
 * SKILL.md §4.3 — "it fires exactly once. Re-running evaluation does not
 * duplicate the event."
 *
 * Asked of every achievement rather than one of them, because `on`
 * `achievement_events_once` being a unique constraint is the reason it holds
 * and a constraint is easy to drop by accident. `evaluate_achievements` also
 * skips held rows now (migration 20260908090200), so this is the assertion that
 * would notice if that skip ever started swallowing a first unlock.
 */
async function expectFiresOnce(user: TestUser, slug: string, onDate: string): Promise<void> {
  const unlocked = await awardFor(user, onDate);
  expect(unlocked, `${slug} was reported unlocked a second time`).not.toContain(slug);

  const id = (await achievementIds).get(slug);
  const { count } = await admin
    .from('achievement_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('achievement_id', id!);

  expect(count, `${slug} has more than one unlock event`).toBe(1);
}

/** The values `exercises_movement_pattern_check` allows — migration 0002. */
const MOVEMENT_PATTERNS = ['push', 'pull', 'squat', 'hinge', 'carry', 'core', 'isolation'] as const;

/**
 * One shared exercise per movement pattern, read once for the whole file.
 *
 * WHY one small query per pattern rather than one big read of the catalogue:
 * PostgREST caps a response at `max_rows` (1000, supabase/config.toml), and a
 * page that hits the cap is indistinguishable from a complete one — the trap
 * src/db/training.ts already documents. Reading the catalogue and picking
 * distinct patterns out of it would silently start failing as
 * `catalogue has 4 movement patterns, needed 5` once the catalogue passed a
 * thousand rows, with nothing pointing at the cause. Seven single-row lookups
 * cannot truncate.
 */
const catalogue = (async () => {
  const found = new Map<string, string>();

  await Promise.all(
    MOVEMENT_PATTERNS.map(async (pattern) => {
      const { data, error } = await admin
        .from('exercises')
        .select('id')
        .is('user_id', null)
        .eq('movement_pattern', pattern)
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(`reading catalogue for ${pattern}: ${error.message}`);
      if (data) found.set(pattern, data.id);
    })
  );

  return found;
})();

/** Exercise ids covering `count` distinct movement patterns. */
async function exercisesAcrossPatterns(count: number): Promise<string[]> {
  const found = await catalogue;
  const ids = [...found.values()].slice(0, count);
  if (ids.length < count) {
    throw new Error(
      `catalogue covers ${found.size} of ${MOVEMENT_PATTERNS.length} movement patterns, needed ${count}`
    );
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

  it('refuses a signed-out caller the definer function outright', async () => {
    /*
     * INVARIANT: RLS and grants are two independent gates — ADR 0003.
     *
     * `unlocked_achievements()` already fails closed for a signed-out session
     * without this: `achievement_events.user_id` is NOT NULL, so a null
     * auth.uid() makes the comparison NULL rather than true and the result is
     * empty. The grant is the second gate, and this is the assertion that it
     * exists — both of this project's grant defects were invisible until a test
     * looked (migrations 20260901145239 and 20260902094000).
     */
    const { error } = await anonClient().rpc('unlocked_achievements');
    expect(error).not.toBeNull();
  });

  it('refuses a timezone Postgres does not recognise', async () => {
    /*
     * `before-the-birds` evaluates `started_at at time zone u.timezone`, which
     * made users.timezone the input to a definer function for the first time.
     * The column is bare text and its validation lived only in Zod at the app
     * boundary — but `users_update_own` lets an authenticated session PATCH the
     * row directly, straight past Zod. Migration 20260908090300 moved the check
     * into the database.
     *
     * The consequence if it were missing is silence, not a crash:
     * evaluate_achievements swallows the error and the badge stops firing for
     * that user with nothing said. accept_challenge, which does not catch,
     * would throw instead — one bad value, two unrelated symptoms.
     */
    const user = await newUser('ach-badtz');

    const { error } = await user.client
      .from('users')
      .update({ timezone: 'Pacific/Nowhere' })
      .eq('user_id', user.id);
    expect(error).not.toBeNull();

    // A real one still goes through, so the trigger is a validator and not a
    // wall.
    const ok = await user.client
      .from('users')
      .update({ timezone: 'Asia/Jerusalem' })
      .eq('user_id', user.id);
    expect(ok.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hidden — held versus locked
// ---------------------------------------------------------------------------

describe('a hidden badge', () => {
  it('reaches the person who earned it, and no one else', async () => {
    const [owner, stranger] = await Promise.all([
      newUser('ach-groundhog'),
      newUser('ach-stranger'),
    ]);
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
    const [earlyRiser, normalHours] = await Promise.all([
      newUser('ach-early', 'America/New_York'),
      newUser('ach-normal', 'Europe/Berlin'),
    ]);

    await Promise.all([
      addWorkouts(earlyRiser, [
        { localDate: '2026-04-14', startedAt: '2026-04-14T08:30:00Z' }, // 04:30 in New York
      ]),
      addWorkouts(normalHours, [
        { localDate: '2026-04-14', startedAt: '2026-04-14T08:30:00Z' }, // 10:30 in Berlin
        // And the boundary itself. 03:00Z is 05:00 CEST exactly, which the
        // predicate's `< 5` must exclude — the "one rep short" case SKILL.md
        // §4.2 asks for, and the one an off-by-one in the hour would pass.
        { localDate: '2026-04-13', startedAt: '2026-04-13T03:00:00Z' },
      ]),
    ]);

    expect(await awardFor(earlyRiser, '2026-04-15')).toContain('before-the-birds');
    await expectFiresOnce(earlyRiser, 'before-the-birds', '2026-04-16');
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
    const [aheadOfUtc, behindUtc] = await Promise.all([
      newUser('ach-kiritimati', 'Pacific/Kiritimati'),
      newUser('ach-niue', 'Pacific/Niue'),
    ]);

    await Promise.all([
      addWorkouts(aheadOfUtc, [{ localDate: '2026-01-01', startedAt: '2025-12-31T10:30:00Z' }]),
      addWorkouts(behindUtc, [{ localDate: '2025-12-31', startedAt: '2026-01-01T10:00:00Z' }]),
    ]);

    expect(await awardFor(aheadOfUtc, '2026-01-02')).toContain('new-years-day');
    await expectFiresOnce(aheadOfUtc, 'new-years-day', '2026-01-03');
    expect(await awardFor(behindUtc, '2026-01-02')).not.toContain('new-years-day');
  });

  it('marks an anniversary and not the day after it', async () => {
    // Non-UTC on purpose: SKILL.md §4.4 asks for a calendar achievement to be
    // proved against a fixture in a timezone that is not the server's, and a
    // default-'UTC' fixture is the one case that cannot distinguish the two.
    const user = await newUser('ach-anniversary', 'Pacific/Auckland');

    await addWorkout(user, { localDate: '2025-03-10' });
    // One year and one day. Same season, wrong date.
    await addWorkout(user, { localDate: '2026-03-11' });
    expect(await awardFor(user, '2026-03-12')).not.toContain('one-year-on');

    await addWorkout(user, { localDate: '2026-03-10' });
    expect(await awardFor(user, '2026-03-13')).toContain('one-year-on');
    await expectFiresOnce(user, 'one-year-on', '2026-03-14');
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
    await expectFiresOnce(user, 'twenty-of-twenty-eight', '2026-05-21');
  });

  it('volume: a hundred tonnes, without an implausible set helping', async () => {
    const user = await newUser('ach-volume');
    const exerciseId = await anyExercise();

    // Thirty days of ten sets at 105 kg for three reps: 3,150 kg a day and
    // 94,500 in total — past the day gate, short of the tonnage one.
    //
    // Other badges fire along the way and that is fine: every assertion here
    // names the one slug under test, and vitest prints the rest of the list on
    // failure, which is information rather than noise.
    const ids = await addWorkouts(
      user,
      Array.from({ length: 30 }, (_, n) => ({ localDate: june(n + 1) }))
    );

    await Promise.all(
      ids.map((workoutId) =>
        addSets(user, workoutId, { exerciseId, weightKg: 105, reps: 3, count: 10 })
      )
    );

    // Two sets nobody lifted, one past each bound. Either alone would clear the
    // badge if the predicate counted it: 900 x 100 is 90,000 kg and 200 x 150
    // is 30,000, against the 5,500 actually missing.
    await addSetGroups(user, ids[0]!, [
      {
        exerciseId,
        weightKg: MAX_PLAUSIBLE_WEIGHT_KG + 400,
        reps: MAX_PLAUSIBLE_REPS,
        count: 1,
        from: 200,
      },
      { exerciseId, weightKg: 200, reps: MAX_PLAUSIBLE_REPS + 50, count: 1, from: 201 },
    ]);

    expect(await awardFor(user, june(30))).not.toContain('hundred-tonnes');

    // 12,000 kg more of real work, on a day already counted, so only the
    // tonnage moves.
    await addSets(user, ids[0]!, { exerciseId, weightKg: 120, reps: 10, count: 10, from: 300 });
    expect(await awardFor(user, june(30))).toContain('hundred-tonnes');
    await expectFiresOnce(user, 'hundred-tonnes', '2026-07-01');
  });

  it('volume: a hundred tonnes in twenty-nine days is not a hundred tonnes', async () => {
    /*
     * The day gate, added in 20260908090400. docs/PRD.md §5.5 and the
     * add-achievement skill both promise that "an empty bar spammed for reps
     * must not unlock a volume badge", and the first version of this predicate
     * did not honour it — fifty sets of 20 kg for 100 reps is a hundred tonnes
     * and every one of them is inside the plausibility bounds.
     *
     * A load floor was rejected: plausibility.ts refuses absolute strength
     * claims on principle. A hundred tonnes not being moved in a weekend claims
     * nothing about how strong anybody is.
     */
    const user = await newUser('ach-volume-fast');
    const exerciseId = await anyExercise();

    // 348,000 kg — three and a half times the threshold — inside 29 days.
    const ids = await addWorkouts(
      user,
      Array.from({ length: 29 }, (_, n) => ({ localDate: june(n + 1) }))
    );
    await Promise.all(
      ids.map((workoutId) =>
        addSets(user, workoutId, { exerciseId, weightKg: 120, reps: 10, count: 10 })
      )
    );

    expect(await awardFor(user, june(29))).not.toContain('hundred-tonnes');

    // A thirtieth day, carrying almost nothing. Time was the missing ingredient.
    const [last] = await addWorkouts(user, [{ localDate: june(30) }]);
    await addSets(user, last!, { exerciseId, weightKg: 20, reps: 5, count: 1 });
    expect(await awardFor(user, june(30))).toContain('hundred-tonnes');
    await expectFiresOnce(user, 'hundred-tonnes', '2026-07-02');
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
    await expectFiresOnce(user, 'twenty-percent-up', '2026-06-14');
  });

  it('pr: "first" means the earliest session, not the earliest row', async () => {
    /*
     * The case the test above cannot see: it puts both sets in ONE workout, so
     * `set_index` settles the order and any ordering key gets the right answer.
     * Across workouts the predicate was ordering by `sets.created_at` and then
     * by `workout_id` — write time, then a random uuid — which is migration
     * 20260908130000's subject. That comment carries the measurement.
     *
     * The insert order here is deliberately the reverse of the training order,
     * which is what makes this deterministic rather than a coin toss: the light
     * sets are written FIRST, so they win on `created_at` outright and the old
     * predicate cannot pick the heavy session however the uuids fall.
     *
     * It is also a real story. Logging a session you did last week, after
     * logging this week's, must not mint a personal best out of nothing.
     */
    const user = await newUser('ach-pr-order');
    const exerciseId = await anyExercise();

    // Written first, trained second: 100 kg on the 12th.
    const later = await addWorkout(user, { localDate: '2026-06-12' });
    await addSets(user, later, { exerciseId, weightKg: 100, reps: 5, count: 6 });

    // Written second, trained first: 120 kg on the 10th. This is where the
    // user started, so their best is exactly their first and nothing is up.
    const earlier = await addWorkout(user, { localDate: '2026-06-10' });
    await addSets(user, earlier, { exerciseId, weightKg: 120, reps: 5, count: 6 });

    // 120 / 100 is exactly the 20% the badge wants — so ordering by write time
    // awards it here, and ordering by training date correctly does not.
    expect(await awardFor(user, '2026-06-13')).not.toContain('twenty-percent-up');

    // And the badge is still reachable: 145 kg is 20.8% up on the 120 kg start.
    const third = await addWorkout(user, { localDate: '2026-06-14' });
    await addSets(user, third, { exerciseId, weightKg: 145, reps: 5, count: 1 });
    expect(await awardFor(user, '2026-06-14')).toContain('twenty-percent-up');
  });

  it('comeback: twenty-one days away, not twenty', async () => {
    const user = await newUser('ach-comeback');

    await addWorkout(user, { localDate: '2026-07-01' });
    await addWorkout(user, { localDate: '2026-07-21' }); // twenty days
    expect(await awardFor(user, '2026-07-22')).not.toContain('three-weeks-away');

    // A gap of exactly twenty-one, after the run above.
    await addWorkout(user, { localDate: '2026-08-12' });
    expect(await awardFor(user, '2026-08-13')).toContain('three-weeks-away');
    await expectFiresOnce(user, 'three-weeks-away', '2026-08-14');
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
    await expectFiresOnce(user, 'ten-rest-days', '2026-09-13');
  });

  it('variety: five movement patterns, not four', async () => {
    const user = await newUser('ach-variety');
    const exercises = await exercisesAcrossPatterns(5);

    const workoutId = await addWorkout(user, { localDate: '2026-10-01' });
    await addSetGroups(
      user,
      workoutId,
      exercises.slice(0, 4).map((exerciseId, index) => ({
        exerciseId,
        weightKg: 20 + index,
        reps: 10,
        count: 1,
      }))
    );
    expect(await awardFor(user, '2026-10-01')).not.toContain('five-patterns');

    const second = await addWorkout(user, { localDate: '2026-10-02' });
    await addSets(user, second, { exerciseId: exercises[4]!, weightKg: 25, reps: 10, count: 1 });
    expect(await awardFor(user, '2026-10-02')).toContain('five-patterns');
    await expectFiresOnce(user, 'five-patterns', '2026-10-03');
  });

  it("variety: another user's custom exercise does not count, and your own does", async () => {
    /*
     * FOUND IN REVIEW of PR #43. The join to `exercises` was unscoped, and this
     * predicate runs inside the `security definer` evaluator — so a set logged
     * against somebody else's custom exercise counted its movement pattern, and
     * whether the badge fired said what that pattern was. Migration
     * 20260911100000 scopes the join to `(e.user_id is null or e.user_id = $1)`.
     *
     * The cross-user set goes in with the service role, which is how a row
     * written before that migration would already exist; `sets_own` refuses it
     * now, and tests/db/rls.test.ts says so. The predicate has to hold the line
     * either way — the two layers of 20260908140000.
     *
     * The near miss and the unlock use the same four shared patterns plus the
     * same fifth pattern, once on a stranger's exercise and once on the user's
     * own, so the only thing that differs between no badge and badge is whose
     * exercise it is. The second half matters as much as the first: a filter
     * that dropped the user's OWN custom exercises would pass the first alone.
     */
    const user = await newUser('ach-variety-own');
    const stranger = await newUser('ach-variety-stranger');

    const four = [...(await catalogue).entries()].slice(0, 4);
    expect(four, 'the catalogue needs four movement patterns').toHaveLength(4);
    const fifth = MOVEMENT_PATTERNS.find((p) => !four.some(([pattern]) => pattern === p))!;

    const customExercise = async (owner: TestUser, label: string): Promise<string> => {
      const { data, error } = await admin
        .from('exercises')
        .insert({
          user_id: owner.id,
          slug: `${label}-${Date.now()}`,
          name: `${label} (custom)`,
          primary_muscle: 'quadriceps',
          movement_pattern: fifth,
          source: 'custom',
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(`inserting ${label}: ${error?.message}`);
      return data.id;
    };
    const theirs = await customExercise(stranger, 'stranger-lift');
    const mine = await customExercise(user, 'own-lift');

    const first = await addWorkout(user, { localDate: '2026-10-10' });
    await addSetGroups(
      user,
      first,
      four.map(([, exerciseId], index) => ({
        exerciseId,
        weightKg: 20 + index,
        reps: 10,
        count: 1,
      }))
    );
    expect(await awardFor(user, '2026-10-10')).not.toContain('five-patterns');

    /*
     * Both custom-exercise sets are removed here rather than left to afterAll.
     * That deletes users in creation order, so she goes before the stranger and
     * her set on his exercise would cascade away before its `on delete
     * restrict` could block him — but this test should not lean on the order
     * of a hook written for the whole file, and removing the rows leaves
     * nothing behind either way.
     */
    const pointing: string[] = [];
    const logOn = async (workoutId: string, exerciseId: string): Promise<void> => {
      const { data, error } = await admin
        .from('sets')
        .insert({
          user_id: user.id,
          workout_id: workoutId,
          exercise_id: exerciseId,
          set_index: 0,
          weight_kg: 30,
          reps: 10,
          is_warmup: false,
        })
        .select('id')
        .single();
      if (error || !data) throw new Error(`inserting a custom-exercise set: ${error?.message}`);
      pointing.push(data.id);
    };

    let failed = false;
    let failure: unknown;
    try {
      await logOn(await addWorkout(user, { localDate: '2026-10-11' }), theirs);
      expect(
        await awardFor(user, '2026-10-11'),
        "a stranger's custom exercise counted toward five patterns"
      ).not.toContain('five-patterns');

      await logOn(await addWorkout(user, { localDate: '2026-10-12' }), mine);
      expect(await awardFor(user, '2026-10-12'), 'her own custom exercise did not count').toContain(
        'five-patterns'
      );
    } catch (error) {
      failed = true;
      failure = error;
    }

    /*
     * The cleanup always runs, and the body's failure outranks it — without a
     * `throw` inside `finally`, which lint forbids for exactly the masking this
     * is avoiding. `failed` is its own flag because `throw undefined` is legal
     * and would otherwise read as a pass. A cleanup failure behind a body
     * failure rides along as its `cause` — beside any cause it already had —
     * rather than vanishing.
     */
    let cleanup: Error | undefined;
    if (pointing.length > 0) {
      const { error } = await admin.from('sets').delete().in('id', pointing);
      if (error) cleanup = new Error(`removing the custom-exercise sets: ${error.message}`);
    }
    if (failed) {
      const error = failure instanceof Error ? failure : new Error(String(failure));
      if (cleanup) {
        error.cause =
          error.cause === undefined ? cleanup : new AggregateError([error.cause, cleanup]);
      }
      throw error;
    }
    if (cleanup) throw cleanup;
  });
});

// ---------------------------------------------------------------------------
// The catalogue — ADR 0017's 2026-09-12 amendment, rework PR 7
// ---------------------------------------------------------------------------

/** Shared hidden achievements, counted with the service role — the truth. */
async function sharedHiddenCount(): Promise<number> {
  const { count, error } = await admin
    .from('achievements')
    .select('id', { count: 'exact', head: true })
    .is('user_id', null)
    .eq('hidden', true);
  if (error) throw new Error(`counting hidden achievements: ${error.message}`);
  return count ?? 0;
}

describe('the badge catalogue', () => {
  it('says how to earn every shared badge, and refuses a shared row that does not', async () => {
    const { data, error } = await admin
      .from('achievements')
      .select('slug, how_to_earn')
      .is('user_id', null);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);

    const blank = (data ?? []).filter((row) => (row.how_to_earn ?? '').trim() === '');
    expect(blank.map((row) => row.slug)).toEqual([]);

    // The constraint, not just today's rows: the next migration that forgets it
    // fails when it is applied.
    const slug = `no-how-${Date.now()}`;
    const refused = await admin.from('achievements').insert({
      user_id: null,
      slug,
      name: 'No instructions',
      description: 'Should not insert.',
      how_to_earn: '   ',
      predicate: '(select false)',
      tier: 'consistency',
    });
    // Removed BEFORE the assertion: if the constraint were missing, a failed
    // expect would otherwise leave a blank shared row for every later test.
    await admin.from('achievements').delete().eq('slug', slug).is('user_id', null);
    expect(refused.error).not.toBeNull();
  });

  it('never sends a locked hidden badge — its instructions included — only a count', async () => {
    /*
     * SKILL.md §4.5, first half, for the catalogue: the definition is absent
     * while it is LOCKED, and `how_to_earn` is part of the definition.
     */
    const user = await newUser('cat-locked');
    const hiddenTotal = await sharedHiddenCount();
    expect(hiddenTotal, 'nothing hidden to withhold — this test would be vacuous').toBeGreaterThan(
      0
    );

    // The table directly, asking for the new column by name.
    const { data: rows, error } = await user.client
      .from('achievements')
      .select('slug, how_to_earn, hidden');
    expect(error).toBeNull();
    expect((rows ?? []).filter((row) => row.hidden)).toEqual([]);

    // And the page's own read.
    const catalogue = await loadBadgeCatalogue(user.client, 'crude');
    const { data: hiddenSlugs } = await admin
      .from('achievements')
      .select('slug')
      .is('user_id', null)
      .eq('hidden', true);
    const secret = new Set((hiddenSlugs ?? []).map((row) => row.slug));

    expect(catalogue.toGet.filter((badge) => secret.has(badge.slug))).toEqual([]);
    expect(catalogue.earned).toEqual([]);
    expect(catalogue.hiddenRemaining).toBe(hiddenTotal);

    // Nothing in what the page received names a hidden badge, in any field.
    const sent = JSON.stringify(catalogue);
    for (const slug of secret) expect(sent).not.toContain(slug);
  });

  it('moves a hidden badge from the count to the shelf once it is earned', async () => {
    // SKILL.md §4.5, second half: present for the holder once earned.
    const user = await newUser('cat-found');
    const exerciseId = await anyExercise();
    const before = await loadBadgeCatalogue(user.client, 'cheeky');

    const workoutId = await addWorkout(user, { localDate: '2026-05-04' });
    await addSets(user, workoutId, { exerciseId, weightKg: 50, reps: 5, count: 20 });
    expect(await awardFor(user, '2026-05-04')).toContain('groundhog-set');

    const after = await loadBadgeCatalogue(user.client, 'cheeky');
    expect(after.hiddenRemaining).toBe(before.hiddenRemaining - 1);
    expect(after.earned.find((badge) => badge.slug === 'groundhog-set')).toMatchObject({
      name: 'Groundhog Set',
      hidden: true,
    });
    expect(after.toGet.map((badge) => badge.slug)).not.toContain('groundhog-set');
  });

  it('lists a held VISIBLE badge once, as earned and not as still to get', async () => {
    const user = await newUser('cat-visible');
    const exerciseIds = await exercisesAcrossPatterns(5);
    const workoutId = await addWorkout(user, { localDate: '2026-05-11' });
    await addSetGroups(
      user,
      workoutId,
      exerciseIds.map((exerciseId, i) => ({ exerciseId, weightKg: 20, reps: 5, count: 1, from: i }))
    );
    expect(await awardFor(user, '2026-05-11')).toContain('five-patterns');

    const catalogue = await loadBadgeCatalogue(user.client, 'cheeky');
    expect(catalogue.earned.map((badge) => badge.slug)).toContain('five-patterns');
    expect(catalogue.toGet.map((badge) => badge.slug)).not.toContain('five-patterns');
    // Everything else visible is still offered, with its instructions.
    expect(catalogue.toGet.length).toBeGreaterThan(0);
    expect(catalogue.toGet.every((badge) => badge.howToEarn.trim().length > 0)).toBe(true);
  });

  it('counts for the caller only, and refuses a signed-out caller', async () => {
    const [finder, stranger] = await Promise.all([newUser('cat-count-a'), newUser('cat-count-b')]);
    const exerciseId = await anyExercise();

    const workoutId = await addWorkout(finder, { localDate: '2026-05-18' });
    await addSets(finder, workoutId, { exerciseId, weightKg: 30, reps: 10, count: 20 });
    expect(await awardFor(finder, '2026-05-18')).toContain('groundhog-set');

    // No parameter exists to ask about somebody else; the stranger's own count
    // is untouched by what the finder earned.
    const theirs = await stranger.client.rpc('hidden_achievements_remaining');
    expect(theirs.error).toBeNull();
    expect(theirs.data).toBe(await sharedHiddenCount());

    // INVARIANT: RLS and grants are two independent gates — ADR 0003. The
    // function returns 0 for a null auth.uid() as well; this is the grant.
    const { error } = await anonClient().rpc('hidden_achievements_remaining');
    expect(error).not.toBeNull();
  });
});
