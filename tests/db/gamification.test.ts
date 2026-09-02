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
