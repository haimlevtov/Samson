/**
 * Which session counts as the one you are in.
 *
 * These need a real database because every claim is about a query rather than
 * about arithmetic: what PostgREST does with a `gte` on a timestamp, where it
 * puts nulls in a descending sort, and whether a `neq` filter eats a row out of
 * a `limit`. None of that is provable against a stub — a stub would only prove
 * that the stub agrees with itself.
 *
 * INVARIANT: the service role creates fixtures; every assertion runs through a
 *            user-scoped client — the same split as tests/db/rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createTestUser, deleteTestUser, type TestUser } from './helpers';
import { ACTIVE_SESSION_WINDOW_HOURS, activeWorkout, listWorkouts } from '../../src/db/training';

let alice: TestUser;
let bob: TestUser;

/** Far enough back that nothing here collides with a seeded fixture. */
const DAY = '2026-05-04';

const hoursAgo = (h: number): string => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

/** A workout row owned by `user`, returning its id. */
async function makeWorkout(
  userId: string,
  fields: { status: string; local_date: string; started_at?: string | null }
): Promise<string> {
  const { data, error } = await adminClient()
    .from('workouts')
    .insert({
      user_id: userId,
      local_date: fields.local_date,
      status: fields.status,
      started_at: fields.started_at ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`fixture insert failed: ${error.message}`);
  return data.id;
}

beforeAll(async () => {
  alice = await createTestUser('session-routing-a');
  bob = await createTestUser('session-routing-b');
}, 60_000);

afterAll(async () => {
  await deleteTestUser(alice);
  await deleteTestUser(bob);
});

describe('activeWorkout — the recency window', () => {
  it('finds a session started an hour ago', async () => {
    const id = await makeWorkout(alice.id, {
      status: 'in_progress',
      local_date: DAY,
      started_at: hoursAgo(1),
    });

    const active = await activeWorkout(alice.client);
    expect(active?.id).toBe(id);
  });

  it('ignores one that started before the window opened', async () => {
    /*
     * The reason the guard is a duration and not `local_date = today`: an
     * abandoned session must not become a redirect nobody can escape. It stays
     * in History instead, which is where a loose end belongs.
     */
    await makeWorkout(bob.id, {
      status: 'in_progress',
      local_date: DAY,
      started_at: hoursAgo(ACTIVE_SESSION_WINDOW_HOURS + 1),
    });

    expect(await activeWorkout(bob.client)).toBeNull();
  });

  it('still finds one that crossed midnight', async () => {
    /*
     * THE CASE THAT DROVE THE CHANGE. Under `local_date = today` a session
     * begun at 23:55 vanished from the guard at midnight while the user was
     * still logging into it, so Start reappeared and a tap made a second row —
     * the exact bug this whole change exists to prevent.
     *
     * `local_date` is deliberately yesterday here while `started_at` is recent,
     * which is precisely the shape the old query got wrong.
     */
    const yesterday = '2026-05-03';
    const id = await makeWorkout(alice.id, {
      status: 'in_progress',
      local_date: yesterday,
      started_at: hoursAgo(2),
    });

    const active = await activeWorkout(alice.client);
    expect(active?.id).toBe(id);
    expect(active?.localDate).toBe(yesterday);
  });

  it('ignores a finished session however recent', async () => {
    await makeWorkout(bob.id, {
      status: 'completed',
      local_date: DAY,
      started_at: hoursAgo(1),
    });

    expect(await activeWorkout(bob.client)).toBeNull();
  });
});

describe('activeWorkout — which row wins', () => {
  it('takes the most recently started of several', async () => {
    await makeWorkout(alice.id, {
      status: 'in_progress',
      local_date: DAY,
      started_at: hoursAgo(5),
    });
    const newest = await makeWorkout(alice.id, {
      status: 'in_progress',
      local_date: DAY,
      started_at: hoursAgo(1),
    });

    expect((await activeWorkout(alice.client))?.id).toBe(newest);
  });

  it('is not hijacked by a row with no start time', async () => {
    /*
     * `order by started_at desc` is NULLS FIRST in Postgres, so a null would
     * outrank every real session and win the limit(1). The `gte` excludes it
     * outright — this pins that, because the filter is the only thing standing
     * between this and the sibling bug documented on loadExerciseHistory.
     */
    const real = await makeWorkout(bob.id, {
      status: 'in_progress',
      local_date: DAY,
      started_at: hoursAgo(1),
    });
    await makeWorkout(bob.id, { status: 'in_progress', local_date: DAY, started_at: null });

    expect((await activeWorkout(bob.client))?.id).toBe(real);
  });
});

describe('activeWorkout — RLS', () => {
  it('never returns another user’s session', async () => {
    await makeWorkout(bob.id, {
      status: 'in_progress',
      local_date: DAY,
      started_at: hoursAgo(1),
    });

    // Alice has nothing running; Bob does. The query carries no user_id filter
    // and relies entirely on RLS — CLAUDE.md #10.
    expect(await activeWorkout(alice.client)).toBeNull();
  });
});

describe('listWorkouts — excluding the running session', () => {
  it('leaves out the excluded id and still fills the limit', async () => {
    /*
     * The semantics the page silently depends on. `.neq()` is applied by
     * PostgREST as a WHERE clause and `.limit()` as a LIMIT, so Postgres
     * filters BEFORE it counts — excluding a row does not cost a slot. A
     * future refactor to filtering in JavaScript would quietly return one row
     * fewer than asked for, and nothing else would notice.
     */
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(await makeWorkout(alice.id, { status: 'completed', local_date: `2026-05-1${i}` }));
    }

    const excluded = ids[0]!;
    const rows = await listWorkouts(alice.client, 3, excluded);

    expect(rows).toHaveLength(3);
    expect(rows.map((w) => w.id)).not.toContain(excluded);
  });

  it('returns everything when nothing is excluded', async () => {
    const rows = await listWorkouts(alice.client, 40, null);
    expect(rows.length).toBeGreaterThan(0);
  });
});
