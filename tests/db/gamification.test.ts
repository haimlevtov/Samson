/**
 * The enforced half of phase 4's security criteria.
 *
 * The unit suite proves the arithmetic. These prove the things that are only
 * true because the DATABASE makes them true — they run against real Postgres
 * with real RLS, and every one of them would still pass if the application code
 * were deleted.
 *
 *   - "No completion can be granted from the client"
 *   - "No sequence of sessions can breach the ceiling"
 *   - ADR 0009 §3: user-authored predicates are never executed
 *
 * INVARIANT: the service role creates fixtures; every assertion runs through a
 *            user-scoped client — the same split as tests/db/rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers';
import { WEEKLY_XP_CEILING } from '../../src/gamification/xp';

let alice: TestUser;
let bob: TestUser;

/** Monday of a week far enough back that no fixture collides with another. */
const WEEK_START = '2026-06-01';

beforeAll(async () => {
  [alice, bob] = await Promise.all([createTestUser('xp-alice'), createTestUser('xp-bob')]);
}, 60_000);

afterAll(async () => {
  await Promise.all([deleteTestUser(alice), deleteTestUser(bob)]);
});

// ---------------------------------------------------------------------------
// "No completion can be granted from the client"
// ---------------------------------------------------------------------------

describe('the client cannot grant itself anything', () => {
  it('refuses a direct xp_events insert from a signed-in user', async () => {
    const { error } = await alice.client.from('xp_events').insert({
      user_id: alice.id,
      source: 'adherence',
      amount: 500,
      local_date: WEEK_START,
      week_start: WEEK_START,
    });

    // RLS has SELECT policies on this table and no INSERT policy at all, so
    // there is nothing to satisfy — the write is refused outright.
    expect(error).not.toBeNull();
  });

  it('refuses a direct achievement_events insert from a signed-in user', async () => {
    const admin = adminClient();
    const { data: achievement } = await admin
      .from('achievements')
      .select('id')
      .is('user_id', null)
      .limit(1)
      .single();

    expect(achievement, 'a system achievement must exist to test against').not.toBeNull();

    const { error } = await alice.client.from('achievement_events').insert({
      user_id: alice.id,
      achievement_id: achievement!.id,
      local_date: WEEK_START,
    });

    expect(error).not.toBeNull();
  });

  it('awards nothing for a workout the caller does not own', async () => {
    const admin = adminClient();
    const { data: workout } = await admin
      .from('workouts')
      .insert({ user_id: bob.id, local_date: WEEK_START, status: 'completed' })
      .select('id')
      .single();

    // Alice asks for XP against Bob's workout. The RPC filters on auth.uid(),
    // so it finds nothing and awards nothing rather than paying the wrong user.
    const { data } = await alice.client.rpc('award_session_xp', {
      p_workout_id: workout!.id,
    });

    expect((data as { awarded: number }).awarded).toBe(0);

    const { data: bobXp } = await admin.from('xp_events').select('amount').eq('user_id', bob.id);
    expect(bobXp ?? []).toHaveLength(0);
  });

  it('awards nothing for a workout that is not finished', async () => {
    const admin = adminClient();
    const { data: workout } = await admin
      .from('workouts')
      .insert({ user_id: alice.id, local_date: '2026-06-02', status: 'in_progress' })
      .select('id')
      .single();

    const { data } = await alice.client.rpc('award_session_xp', { p_workout_id: workout!.id });
    expect((data as { awarded: number }).awarded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// "No sequence of sessions can breach the ceiling"
// ---------------------------------------------------------------------------

describe('the weekly ceiling is enforced by the database', () => {
  it('refuses a single insert above the ceiling, bypassing all application code', async () => {
    const admin = adminClient();

    // The service role, with RLS irrelevant and the TypeScript clamp not in the
    // picture at all. If the ceiling were only application arithmetic, this
    // would succeed.
    const { error } = await admin.from('xp_events').insert({
      user_id: alice.id,
      source: 'adherence',
      amount: WEEKLY_XP_CEILING + 1,
      local_date: '2026-06-03',
      week_start: WEEK_START,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/ceiling/i);
  });

  it('refuses the insert that would cross the ceiling, not just an oversized one', async () => {
    const admin = adminClient();
    const week = '2026-06-08';

    // Two inserts that are individually fine and jointly over.
    const first = await admin.from('xp_events').insert({
      user_id: alice.id,
      source: 'adherence',
      amount: WEEKLY_XP_CEILING - 10,
      local_date: week,
      week_start: week,
    });
    expect(first.error).toBeNull();

    const second = await admin.from('xp_events').insert({
      user_id: alice.id,
      source: 'challenge',
      amount: 50,
      local_date: week,
      week_start: week,
    });
    expect(second.error).not.toBeNull();

    const { data } = await admin
      .from('xp_events')
      .select('amount')
      .eq('user_id', alice.id)
      .eq('week_start', week);
    const total = (data ?? []).reduce((sum, r) => sum + r.amount, 0);
    expect(total).toBeLessThanOrEqual(WEEKLY_XP_CEILING);
  });

  it('scopes the ceiling per user and per week, not globally', async () => {
    const admin = adminClient();

    // Bob is unaffected by Alice having spent her week.
    const bobInsert = await admin.from('xp_events').insert({
      user_id: bob.id,
      source: 'adherence',
      amount: 400,
      local_date: '2026-06-08',
      week_start: '2026-06-08',
    });
    expect(bobInsert.error).toBeNull();

    // And a different week is a fresh allowance for Alice.
    const nextWeek = await admin.from('xp_events').insert({
      user_id: alice.id,
      source: 'adherence',
      amount: 400,
      local_date: '2026-06-15',
      week_start: '2026-06-15',
    });
    expect(nextWeek.error).toBeNull();
  });

  it('pins the TypeScript constant to the database constant', async () => {
    const admin = adminClient();

    // One XP under the cap in a clean week must succeed, and one over must not.
    // That brackets the database's number without reading it out of the source,
    // which is what makes this a pin rather than a restatement.
    const week = '2026-07-06';
    const under = await admin.from('xp_events').insert({
      user_id: bob.id,
      source: 'adherence',
      amount: WEEKLY_XP_CEILING,
      local_date: week,
      week_start: week,
    });
    expect(under.error, `the database should accept exactly ${WEEKLY_XP_CEILING}`).toBeNull();

    const over = await admin.from('xp_events').insert({
      user_id: bob.id,
      source: 'challenge',
      amount: 1,
      local_date: week,
      week_start: week,
    });
    expect(over.error, 'the database should refuse one XP more').not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ADR 0009 §3 — the privilege escalation
// ---------------------------------------------------------------------------

describe('achievement predicates', () => {
  it('never executes a predicate from a user-owned achievement row', async () => {
    const admin = adminClient();

    /*
     * The attack: achievements.predicate is SQL text, the phase 0 policy
     * `achievements_write` lets a user insert their own row, and the evaluator
     * runs inside a SECURITY DEFINER function. A predicate of `(select true)`
     * unlocks unconditionally IF it is ever evaluated, so its absence from the
     * result is the proof that user rows are never executed.
     */
    const slug = `escalation-probe-${Date.now()}`;
    const { data: evil, error: insertError } = await alice.client
      .from('achievements')
      .insert({
        user_id: alice.id,
        slug,
        name: 'Probe',
        description: 'Must never be evaluated',
        predicate: '(select true)',
        tier: 'consistency',
        humor_level: 'clean',
        hidden: false,
      })
      .select('id')
      .single();

    // The insert itself is allowed — that is the policy, and it is why the
    // evaluator has to be the thing that refuses.
    expect(insertError, 'a user can still own an achievement row').toBeNull();

    const { data: workout } = await admin
      .from('workouts')
      .insert({ user_id: alice.id, local_date: '2026-07-13', status: 'completed' })
      .select('id')
      .single();

    await alice.client.rpc('award_session_xp', { p_workout_id: workout!.id });

    const { data: events } = await admin
      .from('achievement_events')
      .select('achievement_id')
      .eq('user_id', alice.id)
      .eq('achievement_id', evil!.id);

    expect(events ?? [], 'a user-authored predicate was executed').toHaveLength(0);

    await admin.from('achievements').delete().eq('id', evil!.id);
  });

  it('does not expose the evaluator to a signed-in client', async () => {
    // Granting execute would let a client ask which achievements WOULD fire,
    // which leaks hidden achievement definitions by another route — ADR 0009.
    const { error } = await alice.client.rpc(
      'evaluate_achievements' as 'award_session_xp',
      { p_user_id: alice.id } as unknown as { p_workout_id: string }
    );

    expect(error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Awarded exactly once
// ---------------------------------------------------------------------------

describe('awards fire exactly once', () => {
  it('does not award the same workout twice', async () => {
    const admin = adminClient();
    const week = '2026-07-20';

    const { data: workout } = await admin
      .from('workouts')
      .insert({ user_id: bob.id, local_date: week, status: 'completed' })
      .select('id')
      .single();

    const first = await bob.client.rpc('award_session_xp', { p_workout_id: workout!.id });
    const second = await bob.client.rpc('award_session_xp', { p_workout_id: workout!.id });

    expect((first.data as { awarded: number }).awarded).toBeGreaterThan(0);
    // The regression this exists for: the second call used to pay again.
    expect((second.data as { awarded: number }).awarded).toBe(0);

    const { data: rows } = await admin
      .from('xp_events')
      .select('amount')
      .eq('user_id', bob.id)
      .eq('week_start', week);
    expect(rows ?? []).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The ceiling is a floor under UPDATE too, not only INSERT
// ---------------------------------------------------------------------------

describe('the ceiling survives an update, not just an insert', () => {
  it('refuses an update that raises a row past the ceiling', async () => {
    const admin = adminClient();
    const week = '2026-08-03';

    const { data: row, error: insertError } = await admin
      .from('xp_events')
      .insert({
        user_id: alice.id,
        source: 'adherence',
        amount: 100,
        local_date: week,
        week_start: week,
      })
      .select('id')
      .single();
    expect(insertError).toBeNull();

    /*
     * The regression this exists for: the trigger fired `before insert` only,
     * and UPDATE is granted to authenticated and service_role on every public
     * table, so this was the one-line way past a guarantee the ADR calls
     * permanent. Nothing about the amount below is reachable by inserting.
     */
    const { error } = await admin
      .from('xp_events')
      .update({ amount: WEEKLY_XP_CEILING * 10 })
      .eq('id', row!.id);

    expect(error, 'an update past the ceiling must be refused').not.toBeNull();
    expect(error?.message).toMatch(/ceiling/i);
  });

  it('still allows an update that stays inside the ceiling', async () => {
    const admin = adminClient();
    const week = '2026-08-10';

    const { data: row } = await admin
      .from('xp_events')
      .insert({
        user_id: alice.id,
        source: 'adherence',
        amount: WEEKLY_XP_CEILING - 10,
        local_date: week,
        week_start: week,
      })
      .select('id')
      .single();

    /*
     * Deliberately near the cap, because that is the only place the bug this
     * guards against shows. The check has to exclude the row being updated from
     * its own total: without that, correcting 490 to 495 is measured as
     * 490 + 495 and refused, though the week would comfortably hold 495. Far
     * from the ceiling the same bug is invisible, which is why this is not a
     * 10-to-20 test.
     */
    const { error } = await admin
      .from('xp_events')
      .update({ amount: WEEKLY_XP_CEILING - 5 })
      .eq('id', row!.id);

    expect(error, 'a legitimate correction must still be allowed').toBeNull();
  });
});

// ---------------------------------------------------------------------------
// "No SEQUENCE of sessions" has to mean concurrent ones too
// ---------------------------------------------------------------------------

describe('concurrent awards cannot each take the same remaining XP', () => {
  it('clamps rather than races when several calls arrive at once', async () => {
    const admin = adminClient();
    const week = '2026-08-17';

    // Leave exactly 50 XP of room, so every one of the calls below wants more
    // than is left and only one of them can be right.
    const { error: seedError } = await admin.from('xp_events').insert({
      user_id: bob.id,
      source: 'challenge',
      amount: WEEKLY_XP_CEILING - 50,
      local_date: week,
      week_start: week,
    });
    expect(seedError).toBeNull();

    const workouts = await Promise.all(
      [0, 1, 2, 3, 4].map(async (offset) => {
        const { data } = await admin
          .from('workouts')
          .insert({
            user_id: bob.id,
            local_date: `2026-08-${String(17 + offset).padStart(2, '0')}`,
            status: 'completed',
          })
          .select('id')
          .single();
        return data!.id;
      })
    );

    const results = await Promise.all(
      workouts.map((id) => bob.client.rpc('award_session_xp', { p_workout_id: id }))
    );

    /*
     * Two assertions, and the second is the interesting one. Without the
     * advisory lock in award_session_xp the total still cannot exceed the
     * ceiling — the trigger refuses the overshoot — but the losing calls come
     * back as errors, and finishWorkout swallows those, so the user silently
     * loses an award that the rules say should have been clamped to what was
     * left.
     */
    for (const result of results) {
      expect(result.error, 'a concurrent award must clamp, not fail').toBeNull();
    }

    const { data: rows } = await admin
      .from('xp_events')
      .select('amount')
      .eq('user_id', bob.id)
      .eq('week_start', week);
    const total = (rows ?? []).reduce((sum, r) => sum + r.amount, 0);

    expect(total).toBe(WEEKLY_XP_CEILING);
  });
});

// ---------------------------------------------------------------------------
// Two achievements in one session
// ---------------------------------------------------------------------------

describe('a session that unlocks more than one achievement', () => {
  it('records every one of them', async () => {
    const admin = adminClient();
    const stamp = Date.now();
    const slugs = [`probe-a-${stamp}`, `probe-b-${stamp}`];

    /*
     * System rows (user_id null), so the evaluator will run them — that is the
     * whole point. A predicate of `(select true)` unlocks unconditionally, so
     * one workout unlocks both.
     *
     * The regression this exists for: the first once-per-workout index was
     * keyed on (workout_id, source), which made the SECOND achievement's XP
     * insert collide. plpgsql rolls back a block's database work when its
     * handler runs but keeps its variables, so the achievement came back in
     * `unlocked` while its achievement_events row did not survive.
     */
    try {
      const { error: seedError } = await admin.from('achievements').insert(
        slugs.map((slug) => ({
          user_id: null,
          slug,
          name: slug,
          description: 'Fixture, always unlocks',
          predicate: '(select true)',
          tier: 'consistency',
          humor_level: 'clean',
          hidden: false,
        }))
      );
      expect(seedError).toBeNull();

      const { data: workout } = await admin
        .from('workouts')
        .insert({ user_id: alice.id, local_date: '2026-08-24', status: 'completed' })
        .select('id')
        .single();

      const { data, error } = await alice.client.rpc('award_session_xp', {
        p_workout_id: workout!.id,
      });
      expect(error).toBeNull();

      const unlocked = (data as { unlocked: string[] }).unlocked;
      expect(unlocked).toEqual(expect.arrayContaining(slugs));

      // What the UI was told, and what the database kept, must be the same set.
      const { data: ids } = await admin
        .from('achievements')
        .select('id')
        .in('slug', slugs)
        .is('user_id', null);
      const { data: events } = await admin
        .from('achievement_events')
        .select('achievement_id')
        .eq('user_id', alice.id)
        .in(
          'achievement_id',
          (ids ?? []).map((row) => row.id)
        );

      expect(events ?? [], 'every reported unlock must be recorded').toHaveLength(slugs.length);
    } finally {
      // These are global content rows on a shared project. They do not outlive
      // the test even if an assertion above fails.
      await admin.from('achievements').delete().in('slug', slugs).is('user_id', null);
    }
  });
});

// ---------------------------------------------------------------------------
// "Rest is neutral" — the spec property, at the database level
// ---------------------------------------------------------------------------

describe('a rest day earns what a training day earns', () => {
  it('pays a rest day at its position on the curve', async () => {
    const user = await createTestUser('xp-rest');
    try {
      const admin = adminClient();

      const insertWorkout = async (localDate: string, status: 'rest' | 'completed') => {
        const { data } = await admin
          .from('workouts')
          .insert({ user_id: user.id, local_date: localDate, status })
          .select('id')
          .single();
        return data!.id;
      };

      /*
       * Awarded as each day resolves, which is how finishWorkout does it — the
       * RPC derives position from how many kept days exist when it runs.
       *
       * The regression: the workout lookup required status 'completed' while
       * the position count included 'rest', so a rest day paid nothing and
       * still pushed every later session down the curve. Monday earned 0 and
       * Tuesday earned 80, against the 100 + 80 = 180 that weeklyAwards() pays
       * for the same week.
       */
      const monday = await insertWorkout('2026-10-05', 'rest');
      const first = await user.client.rpc('award_session_xp', { p_workout_id: monday });
      expect((first.data as { awarded: number }).awarded, 'a kept rest day earns').toBe(100);

      const tuesday = await insertWorkout('2026-10-06', 'completed');
      const second = await user.client.rpc('award_session_xp', { p_workout_id: tuesday });
      expect((second.data as { awarded: number }).awarded).toBe(80);

      const { data: rows } = await admin
        .from('xp_events')
        .select('amount')
        .eq('user_id', user.id)
        .eq('week_start', '2026-10-05');
      const total = (rows ?? []).reduce((sum, r) => sum + r.amount, 0);
      expect(total, 'the database and weeklyAwards() must agree on the week').toBe(180);
    } finally {
      await deleteTestUser(user);
    }
  });

  it('still earns nothing for a day that has not resolved, or was skipped', async () => {
    const user = await createTestUser('xp-unresolved');
    try {
      const admin = adminClient();

      for (const status of ['planned', 'in_progress', 'skipped'] as const) {
        const { data } = await admin
          .from('workouts')
          .insert({ user_id: user.id, local_date: '2026-10-12', status })
          .select('id')
          .single();

        const { data: result } = await user.client.rpc('award_session_xp', {
          p_workout_id: data!.id,
        });
        expect((result as { awarded: number }).awarded, `${status} must earn nothing`).toBe(0);
      }
    } finally {
      await deleteTestUser(user);
    }
  });
});

// ---------------------------------------------------------------------------
// The first-full-week predicate
// ---------------------------------------------------------------------------

describe('first-full-week', () => {
  /** Seven consecutive kept days, the seventh a rest day. */
  const KEPT_WEEK = [
    ['2026-10-19', 'completed'],
    ['2026-10-20', 'completed'],
    ['2026-10-21', 'completed'],
    ['2026-10-22', 'completed'],
    ['2026-10-23', 'completed'],
    ['2026-10-24', 'completed'],
    ['2026-10-25', 'rest'],
  ] as const;

  async function seedWeek(userId: string, extra: readonly (readonly [string, string])[] = []) {
    const admin = adminClient();
    const { data } = await admin
      .from('workouts')
      .insert(
        [...KEPT_WEEK, ...extra].map(([local_date, status]) => ({
          user_id: userId,
          local_date,
          status,
        }))
      )
      .select('id, local_date, status');
    return data ?? [];
  }

  it('unlocks after seven consecutive kept days', async () => {
    const user = await createTestUser('ach-week');
    try {
      const rows = await seedWeek(user.id);
      const seventh = rows.find((r) => r.local_date === '2026-10-25')!;

      const { data } = await user.client.rpc('award_session_xp', { p_workout_id: seventh.id });

      // The seventh day is a rest day, so this also depends on the RPC awarding
      // rest at all — before that it never ran the evaluator on one.
      expect((data as { unlocked: string[] }).unlocked).toContain('first-full-week');
    } finally {
      await deleteTestUser(user);
    }
  });

  it('still unlocks when a later planned day exists', async () => {
    const user = await createTestUser('ach-week-planned');
    try {
      /*
       * The regression this exists for: the predicate anchored its window to
       * max(local_date) over ALL workout rows with no status filter, while
       * counting only kept ones. A single later row — a session the planner
       * scheduled, or one skipped day — slid the window forward and left six
       * kept days inside it, suppressing the achievement permanently.
       */
      const rows = await seedWeek(user.id, [['2026-10-28', 'planned']]);
      const seventh = rows.find((r) => r.local_date === '2026-10-25')!;

      const { data } = await user.client.rpc('award_session_xp', { p_workout_id: seventh.id });
      expect((data as { unlocked: string[] }).unlocked).toContain('first-full-week');
    } finally {
      await deleteTestUser(user);
    }
  });

  it('does not unlock on six kept days', async () => {
    const user = await createTestUser('ach-week-six');
    try {
      const admin = adminClient();
      const { data: rows } = await admin
        .from('workouts')
        .insert(
          KEPT_WEEK.slice(0, 6).map(([local_date, status]) => ({
            user_id: user.id,
            local_date,
            status,
          }))
        )
        .select('id, local_date');

      const sixth = (rows ?? []).find((r) => r.local_date === '2026-10-24')!;
      const { data } = await user.client.rpc('award_session_xp', { p_workout_id: sixth.id });

      expect((data as { unlocked: string[] }).unlocked).not.toContain('first-full-week');
    } finally {
      await deleteTestUser(user);
    }
  });
});

// ---------------------------------------------------------------------------
// Totals are summed by Postgres, and scoped by RLS
// ---------------------------------------------------------------------------

describe('xp_totals', () => {
  it('sums in the database and counts only the calling user', async () => {
    const [carol, dave] = await Promise.all([
      createTestUser('xp-carol'),
      createTestUser('xp-dave'),
    ]);
    try {
      const admin = adminClient();

      const { error } = await admin.from('xp_events').insert([
        {
          user_id: carol.id,
          source: 'adherence',
          amount: 100,
          local_date: '2026-11-02',
          week_start: '2026-11-02',
        },
        {
          user_id: carol.id,
          source: 'challenge',
          amount: 40,
          local_date: '2026-11-03',
          week_start: '2026-11-02',
        },
        {
          user_id: carol.id,
          source: 'adherence',
          amount: 60,
          local_date: '2026-11-09',
          week_start: '2026-11-09',
        },
        // Someone else's ledger, which must not appear in Carol's totals.
        {
          user_id: dave.id,
          source: 'adherence',
          amount: 250,
          local_date: '2026-11-02',
          week_start: '2026-11-02',
        },
      ]);
      expect(error).toBeNull();

      const { data, error: rpcError } = await carol.client.rpc('xp_totals', {
        p_week_start: '2026-11-02',
      });
      expect(rpcError).toBeNull();

      const totals = data?.[0];
      expect(totals?.this_week, 'the week Carol asked about').toBe(140);
      expect(totals?.lifetime, "Carol's whole ledger, and nobody else's").toBe(200);
    } finally {
      await Promise.all([deleteTestUser(carol), deleteTestUser(dave)]);
    }
  });

  it('returns zeros rather than nulls for a user with no events', async () => {
    const user = await createTestUser('xp-empty');
    try {
      const { data } = await user.client.rpc('xp_totals', { p_week_start: '2026-11-02' });

      // A new user's progress screen renders 0, not "null XP".
      expect(data?.[0]?.this_week).toBe(0);
      expect(data?.[0]?.lifetime).toBe(0);
    } finally {
      await deleteTestUser(user);
    }
  });
});
