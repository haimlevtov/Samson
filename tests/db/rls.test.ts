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
let bobTemplateId: string;
let bobExerciseId: string;
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

  // A template of bob's, for the template_id cases below.
  const bobTemplate = await bob.client
    .from('workout_templates')
    .insert({ user_id: bob.id, name: 'bob only' })
    .select('id')
    .single();
  if (bobTemplate.error) throw new Error(bobTemplate.error.message);
  bobTemplateId = bobTemplate.data.id;

  // A custom exercise of bob's, for the exercise_id cases below.
  const bobExercise = await bob.client
    .from('exercises')
    .insert({
      user_id: bob.id,
      slug: `bob-lift-${Date.now()}`,
      name: 'Bob lift',
      primary_muscle: 'quadriceps',
      movement_pattern: 'carry',
      source: 'custom',
    })
    .select('id')
    .single();
  if (bobExercise.error) throw new Error(bobExercise.error.message);
  bobExerciseId = bobExercise.data.id;

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
   * Users FIRST, and alice before bob. Deleting a user cascades away every
   * set, template item and custom exercise they wrote — including a row a test
   * here left pointing at somebody else's, on a run where a gap is open.
   * Alice's rows are the ones that point at bob's, so she goes first; after
   * that nothing references bob's exercise or template.
   *
   * FOUND IN REVIEW of PR #43: in the other order every cross-user test's own
   * cleanup was load-bearing for this block, and those cleanups ignored their
   * errors. Every step here runs even when an earlier one fails, and the
   * failures are thrown together at the end: a failed user delete must not skip
   * the system-row delete below, which is the one that leaks.
   */
  const failures: string[] = [];
  const attempt = async (step: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      failures.push(`${step}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await attempt('deleting alice', () => deleteTestUser(alice));
  await attempt('deleting bob', () => deleteTestUser(bob));

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
  const [achievement, exercise] = await Promise.all([
    admin.from('achievements').delete().eq('id', hiddenAchievementId),
    admin.from('exercises').delete().eq('id', systemExerciseId),
  ]);

  /*
   * FOUND IN REVIEW: a discarded error here is the same bug again, silently.
   * `exercises.id` is referenced `on delete restrict` from `sets.exercise_id`,
   * `workout_template_items.exercise_id` AND `progression_nodes.exercise_id`.
   * The users are gone by now, and with them every set and item this file
   * wrote, so what can still block this delete is a row nobody here deletes —
   * a progression node pointing at the fixture, say. Swallowing that would
   * reintroduce the leak this block was added to stop, with nothing saying so.
   */
  if (achievement.error) {
    failures.push(`cleaning up the hidden achievement: ${achievement.error.message}`);
  }
  if (exercise.error) {
    failures.push(`cleaning up the system exercise: ${exercise.error.message}`);
  }

  if (failures.length > 0) throw new Error(`afterAll cleanup: ${failures.join('; ')}`);
});

describe('cross-user isolation', () => {
  it('shows alice only her own workouts', async () => {
    // Every row, not a count: later tests in this file add sessions of hers, so
    // a length of one held only while this test happened to run first.
    const { data, error } = await alice.client.from('workouts').select('id, user_id');
    expect(error).toBeNull();
    expect(data!.length, 'her own workout from beforeAll').toBeGreaterThan(0);
    expect(data!.every((row) => row.user_id === alice.id)).toBe(true);
    expect(data!.map((row) => row.id)).not.toContain(bobWorkoutId);
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

  it('stops alice hanging a set off one of bob workouts', async () => {
    /*
     * FOUND IN REVIEW 2026-09-08, and it was accepted when first tried.
     *
     * `sets_own` checked `user_id = auth.uid()` and nothing about `workout_id`.
     * The two columns are independent, and the foreign key runs as the
     * referenced table's owner rather than under RLS, so it resolved bob's
     * workout without complaint.
     *
     * WHY it is worth a policy and not just tidiness: `evaluate_achievements`
     * is `security definer` on tables with no FORCE row level security, so a
     * predicate reads `workouts` with RLS off. `hundred-tonnes` counts
     * `distinct w.local_date` straight off that join — bob's training days
     * would have counted toward alice's thirty. Migration 20260908140000 has
     * the full account.
     *
     * AI-NOTE: this asserts the WRITE half only. `using` was deliberately left
     *          alone so that a row written before the fix stays visible to the
     *          user who has to delete it.
     */
    const { data: exercise } = await alice.client
      .from('exercises')
      .select('id')
      .eq('id', systemExerciseId)
      .single();

    const { error } = await alice.client.from('sets').insert({
      user_id: alice.id,
      workout_id: bobWorkoutId,
      exercise_id: exercise!.id,
      set_index: 0,
      weight_kg: 100,
      reps: 5,
      is_warmup: false,
    });

    expect(error, 'alice attached a set to a workout she does not own').not.toBeNull();
    expect(error!.message.toLowerCase()).toContain('row-level security');
  });

  it('stops alice starting a session from one of bob templates', async () => {
    /*
     * FOUND IN REVIEW of PR #42, 2026-09-11 — the set case above, one table
     * along. `workouts_own` checked `user_id = auth.uid()` and nothing about
     * `template_id`, and the foreign key resolves bob's template without
     * consulting RLS. Two comments in the code claimed RLS refused this.
     *
     * No cleanup here or in the negative cases below, even on a run where the
     * gap is open and the row gets written: afterAll deletes the users first,
     * alice before bob, and that cascades away anything a test let through.
     */
    const { error } = await alice.client.from('workouts').insert({
      user_id: alice.id,
      local_date: '2026-08-24',
      status: 'in_progress',
      template_id: bobTemplateId,
    });

    expect(error, 'alice started a session from a template she does not own').not.toBeNull();
    expect(error!.message.toLowerCase()).toContain('row-level security');
  });

  it('stops alice moving one of her own sessions onto bob template', async () => {
    /*
     * The UPDATE half. Both policies are `for all`, so `with check` runs on the
     * new row of an update as well — this test says so, rather than only the
     * migration's comment.
     */
    const { data: own, error: ownError } = await alice.client
      .from('workouts')
      .insert({ user_id: alice.id, local_date: '2026-08-27', status: 'in_progress' })
      .select('id')
      .single();
    expect(ownError).toBeNull();

    const { error } = await alice.client
      .from('workouts')
      .update({ template_id: bobTemplateId })
      .eq('id', own!.id);

    expect(error, 'alice pointed her own session at a template she does not own').not.toBeNull();
    expect(error!.message.toLowerCase()).toContain('row-level security');
  });

  it('stops alice adding an item to one of bob templates', async () => {
    /*
     * The same gap on `workout_template_items`. An item alice wrote there would
     * be invisible to bob, but the unique `(template_id, position)` constraint
     * would tell her which positions he had used.
     */
    const { error } = await alice.client.from('workout_template_items').insert({
      user_id: alice.id,
      template_id: bobTemplateId,
      exercise_id: systemExerciseId,
      position: 0,
      set_count: 3,
      reps: 5,
    });

    expect(error, 'alice wrote into a template she does not own').not.toBeNull();
    expect(error!.message.toLowerCase()).toContain('row-level security');
  });

  it('stops alice logging a set against one of bob custom exercises', async () => {
    /*
     * FOUND IN REVIEW of PR #43 — the column its own ADR first called harmless.
     * `five-patterns` joins `exercises` inside the `security definer` evaluator
     * with nothing scoping the exercise, so a set of alice's on bob's custom
     * exercise let her read its movement pattern off whether the badge fired.
     * Migration 20260911100000 refuses the set; tests/db/achievements.test.ts
     * holds the predicate to the same line for a row written before it.
     */
    const { data: own, error: ownError } = await alice.client
      .from('workouts')
      .insert({ user_id: alice.id, local_date: '2026-08-28', status: 'completed' })
      .select('id')
      .single();
    expect(ownError).toBeNull();

    const { error } = await alice.client.from('sets').insert({
      user_id: alice.id,
      workout_id: own!.id,
      exercise_id: bobExerciseId,
      set_index: 0,
      weight_kg: 60,
      reps: 5,
      is_warmup: false,
    });

    expect(error, 'alice logged a set on an exercise she cannot see').not.toBeNull();
    expect(error!.message.toLowerCase()).toContain('row-level security');
  });

  it('stops alice prescribing one of bob custom exercises in her own template', async () => {
    const { data: own, error: ownError } = await alice.client
      .from('workout_templates')
      .insert({ user_id: alice.id, name: 'alice, borrowing' })
      .select('id')
      .single();
    expect(ownError).toBeNull();

    const { error } = await alice.client.from('workout_template_items').insert({
      user_id: alice.id,
      template_id: own!.id,
      exercise_id: bobExerciseId,
      position: 0,
      set_count: 3,
      reps: 5,
    });

    expect(error, 'alice prescribed an exercise she cannot see').not.toBeNull();
    expect(error!.message.toLowerCase()).toContain('row-level security');
  });

  it('stops alice moving her own set or template item onto bob rows', async () => {
    /*
     * The UPDATE path of `sets_own` and `workout_template_items_own`, one move
     * per column the fixes added. The policies are `for all`, so `with check`
     * runs on an update's new row — tried here rather than argued. Her rows
     * start valid, on her own session and template and the catalogue, and each
     * move breaks exactly one clause.
     */
    const { data: session, error: sessionError } = await alice.client
      .from('workouts')
      .insert({ user_id: alice.id, local_date: '2026-08-29', status: 'completed' })
      .select('id')
      .single();
    expect(sessionError).toBeNull();

    const { data: set, error: setError } = await alice.client
      .from('sets')
      .insert({
        user_id: alice.id,
        workout_id: session!.id,
        exercise_id: systemExerciseId,
        set_index: 0,
        weight_kg: 60,
        reps: 5,
        is_warmup: false,
      })
      .select('id')
      .single();
    expect(setError).toBeNull();

    const { data: template, error: templateError } = await alice.client
      .from('workout_templates')
      .insert({ user_id: alice.id, name: 'alice, moving' })
      .select('id')
      .single();
    expect(templateError).toBeNull();

    const { data: item, error: itemError } = await alice.client
      .from('workout_template_items')
      .insert({
        user_id: alice.id,
        template_id: template!.id,
        exercise_id: systemExerciseId,
        position: 0,
        set_count: 3,
        reps: 5,
      })
      .select('id')
      .single();
    expect(itemError).toBeNull();

    const moves = [
      [
        'her set onto bob exercise',
        () => alice.client.from('sets').update({ exercise_id: bobExerciseId }).eq('id', set!.id),
      ],
      [
        'her item onto bob exercise',
        () =>
          alice.client
            .from('workout_template_items')
            .update({ exercise_id: bobExerciseId })
            .eq('id', item!.id),
      ],
      [
        'her item into bob template',
        () =>
          alice.client
            .from('workout_template_items')
            .update({ template_id: bobTemplateId })
            .eq('id', item!.id),
      ],
    ] as const;

    for (const [move, run] of moves) {
      const { error } = await run();
      expect(error, `alice moved ${move}`).not.toBeNull();
      expect(error!.message.toLowerCase(), move).toContain('row-level security');
    }
  });

  it('still lets a user use her own template, her own exercise and the catalogue', async () => {
    /*
     * The positive half. A policy that refused everything would pass every
     * negative case above, and the Workout tab and the session grid would stop
     * working for every user.
     *
     * The cleanup at the end is checked, and deliberately not in `finally`: if
     * an assertion fails first, afterAll's user-first delete removes these rows
     * anyway, and a throwing `finally` would replace the real failure with a
     * cleanup one.
     */
    const { data: mine, error: mineError } = await alice.client
      .from('exercises')
      .insert({
        user_id: alice.id,
        slug: `alice-lift-${Date.now()}`,
        name: 'Alice lift',
        primary_muscle: 'quadriceps',
        movement_pattern: 'squat',
        source: 'custom',
      })
      .select('id')
      .single();
    expect(mineError, 'her own custom exercise').toBeNull();

    const { data: template, error: templateError } = await alice.client
      .from('workout_templates')
      .insert({ user_id: alice.id, name: 'alice only' })
      .select('id')
      .single();
    expect(templateError).toBeNull();

    const items = await alice.client.from('workout_template_items').insert([
      {
        user_id: alice.id,
        template_id: template!.id,
        exercise_id: systemExerciseId,
        position: 0,
        set_count: 3,
        reps: 5,
      },
      {
        user_id: alice.id,
        template_id: template!.id,
        exercise_id: mine!.id,
        position: 1,
        set_count: 3,
        reps: 5,
      },
    ]);
    expect(items.error, 'items on the catalogue and on her own exercise').toBeNull();

    const { data: session, error: sessionError } = await alice.client
      .from('workouts')
      .insert({
        user_id: alice.id,
        local_date: '2026-08-25',
        status: 'in_progress',
        template_id: template!.id,
      })
      .select('id')
      .single();
    expect(sessionError, 'a session from her own template').toBeNull();

    const sets = await alice.client.from('sets').insert([
      {
        user_id: alice.id,
        workout_id: session!.id,
        exercise_id: systemExerciseId,
        set_index: 0,
        weight_kg: 60,
        reps: 5,
        is_warmup: false,
      },
      {
        user_id: alice.id,
        workout_id: session!.id,
        exercise_id: mine!.id,
        set_index: 0,
        weight_kg: 40,
        reps: 8,
        is_warmup: false,
      },
    ]);
    expect(sets.error, 'sets on the catalogue and on her own exercise').toBeNull();

    // Finishing re-runs `with check` against the updated row.
    const finished = await alice.client
      .from('workouts')
      .update({ status: 'completed' })
      .eq('id', session!.id);
    expect(finished.error, 'finishing a session started from her own template').toBeNull();

    // A null template_id — every session started without one — must still pass.
    const { error: plainError } = await alice.client
      .from('workouts')
      .insert({ user_id: alice.id, local_date: '2026-08-26', status: 'completed' });
    expect(plainError, 'a session with no template at all').toBeNull();

    // Checked cleanup, in dependency order: the session takes its sets, the
    // template takes its items, and then nothing references her exercise.
    const removedSession = await alice.client.from('workouts').delete().eq('id', session!.id);
    expect(removedSession.error, 'removing her session').toBeNull();
    const removedTemplate = await alice.client
      .from('workout_templates')
      .delete()
      .eq('id', template!.id);
    expect(removedTemplate.error, 'removing her template').toBeNull();
    const removedExercise = await alice.client.from('exercises').delete().eq('id', mine!.id);
    expect(removedExercise.error, 'removing her exercise').toBeNull();
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
