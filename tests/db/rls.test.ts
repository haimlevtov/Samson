/**
 * Phase 0 acceptance criterion: a query as user A cannot read user B's rows.
 *
 * INVARIANT: RLS is on for every table — CLAUDE.md #10
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers';

let alice: TestUser;
let bob: TestUser;
let bobWorkoutId: string;
let systemExerciseId: string;
let hiddenAchievementId: string;

beforeAll(async () => {
  const admin = adminClient();

  [alice, bob] = await Promise.all([createTestUser('alice'), createTestUser('bob')]);

  // System catalogue content: user_id NULL, readable by everyone.
  const exercise = await admin
    .from('exercises')
    .insert({
      slug: `back-squat-${Date.now()}`,
      name: 'Back Squat',
      primary_muscle: 'quadriceps',
      movement_pattern: 'squat',
      source: 'custom',
    })
    .select('id')
    .single();
  if (exercise.error) throw new Error(exercise.error.message);
  systemExerciseId = exercise.data.id;

  const hidden = await admin
    .from('achievements')
    .insert({
      slug: `hidden-fixture-${Date.now()}`,
      name: 'Secret Badge',
      description: 'Should never reach a client.',
      predicate: 'false',
      tier: 'hidden',
      hidden: true,
    })
    .select('id')
    .single();
  if (hidden.error) throw new Error(hidden.error.message);
  hiddenAchievementId = hidden.data.id;

  const bobWorkout = await bob.client
    .from('workouts')
    .insert({ user_id: bob.id, local_date: '2026-08-24', status: 'completed', notes: 'bob only' })
    .select('id')
    .single();
  if (bobWorkout.error) throw new Error(bobWorkout.error.message);
  bobWorkoutId = bobWorkout.data.id;

  await alice.client
    .from('workouts')
    .insert({ user_id: alice.id, local_date: '2026-08-24', status: 'completed' });

  await bob.client.from('llm_calls').insert({
    user_id: bob.id,
    stage: 'planner',
    attempt: 1,
    status: 'ok',
    models_requested: ['x/y'],
    latency_ms: 10,
    cost_credits: 0.001,
  });
});

afterAll(async () => {
  /*
   * The two SYSTEM rows have to be deleted by hand. Deleting the fixture users
   * cascades away everything they own, and `user_id is null` means these belong
   * to nobody — so nothing was cleaning them up.
   *
   * FOUND 2026-09-08, surveying the catalogue for the progression trees.
   * Measured on the hosted project at the moment they were deleted: 29 leaked
   * "Secret Badge" achievements and 8 duplicate "Back Squat" exercises. The two
   * counts differ because the achievement fixture predates the exercise one —
   * they leak in lockstep now, but did not always.
   *
   * WHY it matters more than untidiness: a system achievement is executed by
   * `evaluate_achievements` on EVERY workout completion for EVERY user, forever.
   * The count had reached 39, of which 28 were these, and each predicate costs a
   * plpgsql subtransaction against a ceiling of 64 —
   * .claude/skills/add-achievement/SKILL.md. The demo database was accumulating
   * its way toward a cliff, one test run at a time.
   *
   * CI never saw it: the db job resets a fresh local stack every time. Only a
   * workstation running the suite against hosted accumulates, which is the
   * configuration this project develops in.
   *
   * AI-NOTE: any fixture written with `user_id: null` outlives its test. If you
   *          add one, delete it here.
   */
  const admin = adminClient();
  const cleaned = await Promise.all([
    admin.from('achievements').delete().eq('id', hiddenAchievementId),
    admin.from('exercises').delete().eq('id', systemExerciseId),
  ]);

  /*
   * FOUND IN REVIEW: a discarded error here is the same bug again, silently.
   * `exercises.id` is referenced `on delete restrict` from `sets.exercise_id`
   * AND from `progression_nodes.exercise_id`, so a future test that logs a set
   * against this fixture makes the delete fail — and swallowing that would
   * reintroduce the leak this block was added to stop, with nothing saying so.
   */
  for (const result of cleaned) {
    if (result.error) throw new Error(`cleaning up a system fixture: ${result.error.message}`);
  }

  await Promise.all([deleteTestUser(alice), deleteTestUser(bob)]);
});

describe('cross-user isolation', () => {
  it('shows alice only her own workouts', async () => {
    const { data, error } = await alice.client.from('workouts').select('id, user_id');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]!.user_id).toBe(alice.id);
  });

  it('returns nothing when alice asks for bob by id', async () => {
    const { data, error } = await alice.client.from('workouts').select('id').eq('id', bobWorkoutId);
    // RLS filters rather than errors: the row simply is not there.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('shows alice none of bob llm_calls rows', async () => {
    const { data } = await alice.client.from('llm_calls').select('id');
    expect(data).toEqual([]);
  });

  it('stops alice writing a row owned by bob', async () => {
    const { error } = await alice.client
      .from('workouts')
      .insert({ user_id: bob.id, local_date: '2026-08-24', status: 'completed' });
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toContain('row-level security');
  });

  it('leaves bob rows untouched when alice updates or deletes', async () => {
    await alice.client.from('workouts').update({ notes: 'hijacked' }).eq('id', bobWorkoutId);
    await alice.client.from('workouts').delete().eq('id', bobWorkoutId);

    const { data } = await bob.client.from('workouts').select('notes').eq('id', bobWorkoutId);
    expect(data).toHaveLength(1);
    expect(data![0]!.notes).toBe('bob only');
  });

  it('stops a user erasing their own spend to reset the budget', async () => {
    // WHY: llm_calls has select and insert policies only. Without this, the
    //      weekly budget check reads a table the user can empty.
    await bob.client.from('llm_calls').delete().neq('id', crypto.randomUUID());
    const { data } = await bob.client.from('llm_calls').select('id');
    expect(data).toHaveLength(1);
  });
});

describe('catalogue visibility', () => {
  it('shows system content to every user', async () => {
    for (const user of [alice, bob]) {
      const { data } = await user.client.from('exercises').select('id').eq('id', systemExerciseId);
      expect(data).toHaveLength(1);
    }
  });

  it('never sends a hidden achievement definition to a client', async () => {
    // PLAN.md phase 5 requires this; enforcing it in the policy means no future
    // endpoint can leak them by forgetting a filter.
    const { data } = await alice.client
      .from('achievements')
      .select('id')
      .eq('id', hiddenAchievementId);
    expect(data).toEqual([]);
  });
});

describe('anonymous access', () => {
  it('reaches no rows at all', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { ANON_KEY, SUPABASE_URL } = await import('./helpers');
    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    for (const table of ['users', 'workouts', 'sets', 'exercises', 'llm_calls']) {
      const { data } = await anon.from(table).select('*').limit(1);
      expect(data ?? [], `anon reached ${table}`).toEqual([]);
    }
  });
});
