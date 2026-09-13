/**
 * A rest day, written the way the Workout tab writes it — ADR 0034.
 *
 * `logRestDay` inserts the workout with the user's own RLS-bound client and
 * then calls `award_session_xp`. These tests do exactly that, through a signed-in
 * client and never the service role, so every property below holds because
 * the DATABASE holds it — the same split as tests/db/gamification.test.ts. They
 * would still pass if the action were deleted, and they would fail if the index
 * or the award's handling of 'rest' were.
 *
 * Where a test calls the application's own functions — `insertRestDay`,
 * `workoutsOn`, `restToday` — it is because the property is theirs to keep:
 * reading the index's refusal as "already a rest day" is code, not schema.
 * FOUND IN REVIEW: the first version copied the insert, and so tested nothing
 * the action does with its result.
 *
 * Dates are far from other suites' fixtures. The award tests each have their own
 * user; the RLS tests share alice and bob, on different dates, and award nothing,
 * so none of them shares a week's ceiling or a held badge with another.
 */
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createTestUser, deleteTestUser, deleteTestUsers, type TestUser } from './helpers';
import { insertRestDay, workoutsOn } from '../../src/db/training';
import { restToday } from '../../src/ui/rest';

interface Award {
  awarded: number;
  unlocked: string[];
}

/** A rest day through the action's own insert, which must not report a duplicate. */
async function restDay(user: TestUser, localDate: string): Promise<string> {
  const id = await insertRestDay(user.client, user.id, localDate);
  if (id === null) throw new Error(`${localDate} already had a rest day`);
  return id;
}

async function award(user: TestUser, workoutId: string): Promise<Award> {
  const { data, error } = await user.client.rpc('award_session_xp', { p_workout_id: workoutId });
  if (error) throw new Error(`awarding ${workoutId}: ${error.message}`);
  return data as unknown as Award;
}

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  [alice, bob] = await Promise.all([createTestUser('rest-alice'), createTestUser('rest-bob')]);
}, 60_000);

afterAll(async () => {
  await deleteTestUsers(alice, bob);
});

describe('a rest day under RLS', () => {
  it('is written by its owner, and not for anyone else', async () => {
    await restDay(alice, '2027-02-01');

    const { error } = await alice.client
      .from('workouts')
      .insert({ user_id: bob.id, local_date: '2027-02-01', status: 'rest' });
    expect(error, "a user logged a rest day into someone else's log").not.toBeNull();

    const { data } = await bob.client.from('workouts').select('id').eq('local_date', '2027-02-01');
    expect(data ?? []).toEqual([]);
  });

  it('is one a day: a second press on the same date comes back as the first day', async () => {
    const first = await restDay(alice, '2027-02-03');

    // insertRestDay reads the index's refusal as "already a rest day", not an error.
    expect(await insertRestDay(alice.client, alice.id, '2027-02-03')).toBeNull();
    expect(restToday(await workoutsOn(alice.client, '2027-02-03'))).toEqual({
      kind: 'rested',
      workoutId: first,
    });

    // The next day is a different day, and another user's same date is theirs.
    await restDay(alice, '2027-02-04');
    await restDay(bob, '2027-02-03');
  });

  it('refuses a second rest day by NAME, which is what insertRestDay matches', async () => {
    await restDay(alice, '2027-02-08');

    const { error } = await alice.client
      .from('workouts')
      .insert({ user_id: alice.id, local_date: '2027-02-08', status: 'rest' });
    expect(error, 'two rest days on one date').not.toBeNull();
    expect(error!.code).toBe('23505');
    // AI-NOTE: the index name, as ONE_REST_A_DAY in src/db/training.ts has it.
    expect(error!.message).toContain('workouts_one_rest_a_day');
  });

  it('refuses a second rest day made by UPDATE, not only by insert', async () => {
    // FOUND IN REVIEW: ADR 0034 §3 holds for any row that is 'rest', however it became one.
    await restDay(alice, '2027-02-10');
    const { data: session, error: sessionError } = await alice.client
      .from('workouts')
      .insert({ user_id: alice.id, local_date: '2027-02-10', status: 'completed' })
      .select('id')
      .single();
    if (sessionError) throw new Error(sessionError.message);

    const { error } = await alice.client
      .from('workouts')
      .update({ status: 'rest' })
      .eq('id', session!.id);
    expect(error, 'an update made a second rest day').not.toBeNull();
    expect(error!.code).toBe('23505');
    expect(error!.message).toContain('workouts_one_rest_a_day');
  });

  it('throws on any other refusal, instead of reading it as a rest day that exists', async () => {
    // RLS refuses a row for someone else. That is not "already rested".
    await expect(insertRestDay(alice.client, bob.id, '2027-02-12')).rejects.toThrow(
      /logging a rest day/
    );
  });

  it("reads only the caller's own day", async () => {
    await restDay(bob, '2027-02-14');
    expect(await workoutsOn(alice.client, '2027-02-14')).toEqual([]);
  });

  it('does not stop a session on the same day — ADR 0034 §4 allows it', async () => {
    await restDay(alice, '2027-02-06');

    const { error } = await alice.client
      .from('workouts')
      .insert({ user_id: alice.id, local_date: '2027-02-06', status: 'completed' });
    expect(error, 'the index is partial: only a second REST row is refused').toBeNull();
  });
});

describe('a rest day is paid through award_session_xp, once', () => {
  it('awards what a session in its place would, and nothing on a second call', async () => {
    const user = await createTestUser('rest-once');
    onTestFinished(() => deleteTestUser(user));

    const id = await restDay(user, '2027-03-01');

    const first = await award(user, id);
    // The first kept day of its week — 20260902100000: rest earns as completed does.
    expect(first.awarded, 'a rest day earns').toBe(100);

    const again = await award(user, id);
    expect(again.awarded, 'the same rest day paid twice').toBe(0);
    expect(again.unlocked).toEqual([]);

    const { data: rows, error } = await user.client
      .from('xp_events')
      .select('source, amount')
      .eq('workout_id', id);
    if (error) throw new Error(error.message);
    expect(rows!.filter((r) => r.source === 'adherence')).toEqual([
      { source: 'adherence', amount: 100 },
    ]);
  });
});

describe('ten-rest-days, earned the way the Workout tab earns it', () => {
  it('unlocks on the tenth rest day, not the ninth, and only once', async () => {
    const user = await createTestUser('rest-ten');
    onTestFinished(() => deleteTestUser(user));

    // Every other day, so nothing here is also seven kept days in a row; the
    // badge under test is the only one this history can earn by count.
    const dates = Array.from({ length: 10 }, (_, n) => {
      const day = new Date(Date.UTC(2027, 3, 1 + n * 2));
      return day.toISOString().slice(0, 10);
    });

    const ids: string[] = [];
    for (const [n, date] of dates.entries()) {
      const id = await restDay(user, date);
      ids.push(id);
      const result = await award(user, id);

      if (n < 9) {
        expect(result.unlocked, `rest day ${n + 1} of 10`).not.toContain('ten-rest-days');
      } else {
        expect(result.unlocked, 'the tenth rest day').toContain('ten-rest-days');
      }
    }

    // Replaying the award on the tenth reports nothing new.
    expect((await award(user, ids[9]!)).unlocked).not.toContain('ten-rest-days');

    const { data: badge } = await user.client
      .from('achievements')
      .select('id')
      .eq('slug', 'ten-rest-days')
      .is('user_id', null)
      .single();
    const { data: held, error } = await user.client
      .from('achievement_events')
      .select('local_date')
      .eq('achievement_id', badge!.id);
    if (error) throw new Error(error.message);
    // Once, dated the day that earned it — the user's local date, CLAUDE.md #9.
    expect(held).toEqual([{ local_date: dates[9] }]);
  });

  it('tells the catalogue where a rest day is logged — ADR 0034 §8', async () => {
    const { data, error } = await alice.client
      .from('achievements')
      .select('how_to_earn')
      .eq('slug', 'ten-rest-days')
      .is('user_id', null)
      .single();
    if (error) throw new Error(error.message);
    expect(data!.how_to_earn).toContain('Rest today on the Workout tab');
  });
});
