/**
 * The demo reset against Postgres — ADR 0032 §4.
 *
 * The thing worth proving is not that it deletes. It is that it deletes NOTHING
 * ELSE: the blast radius is the caller, and that is RLS's guarantee rather than
 * the email gate's.
 *
 * INVARIANT: the service role creates fixtures and reads truth; every assertion
 *            about what a reset does runs through a user-scoped client.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RESET_TABLES, resetDemoData } from '../../src/db/demo-reset';
import type { Database } from '../../src/db/types';

/** The tables this file touches, so `.from()` narrows the way it does in src. */
type Table = keyof Database['public']['Tables'];
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from './helpers';

let user: TestUser;
let other: TestUser;

beforeAll(async () => {
  [user, other] = await Promise.all([createTestUser('reset'), createTestUser('reset-other')]);
}, 90_000);

afterAll(async () => {
  await deleteTestUsers(user, other);
});

/** Gives a user one row in each table the reset names, plus a profile. */
async function furnish(id: string, marker: string): Promise<void> {
  const admin = adminClient();

  const put = async (table: Table, row: Record<string, unknown>) => {
    const { error } = await admin.from(table).insert({ user_id: id, ...row });
    if (error) throw new Error(`${table}: ${error.message}`);
  };

  // UPSERT, because `createTestUser` already writes a profile row — the helper
  // does what the seeder does, which is the point of using it.
  const { error: profileError } = await admin
    .from('users')
    .upsert(
      { user_id: id, display_name: marker, bodyweight_kg: 80, diet_goal: 'gain' },
      { onConflict: 'user_id' }
    );
  if (profileError) throw new Error(`users: ${profileError.message}`);
  await put('coach_notes', { text: `${marker} note` });

  const { data: tag } = await admin
    .from('equipment_tags')
    .select('id')
    .is('user_id', null)
    .limit(1);
  if (tag?.[0]) await put('user_equipment', { equipment_tag_id: tag[0].id });

  await put('workouts', { local_date: '2026-09-01', status: 'completed' });
}

const countIn = async (table: Table, id: string): Promise<number> => {
  const { count, error } = await adminClient()
    .from(table)
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', id);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
};

const profileOf = async (id: string) => {
  const { data } = await adminClient()
    .from('users')
    .select('display_name, bodyweight_kg, diet_goal, timezone')
    .eq('user_id', id)
    .maybeSingle();
  return data;
};

describe('resetDemoData', () => {
  it('removes the caller rows and leaves everybody else alone', async () => {
    await furnish(user.id, 'mine');
    await furnish(other.id, 'theirs');

    await resetDemoData(user.client, user.id);

    // INVARIANT: the blast radius is the caller. This is the assertion the whole
    // control rests on, and it is RLS's rather than the email gate's — the gate
    // is not even involved at this layer.
    expect(await countIn('coach_notes', user.id)).toBe(0);
    expect(await countIn('workouts', user.id)).toBe(0);
    expect(await countIn('user_equipment', user.id)).toBe(0);

    expect(await countIn('coach_notes', other.id)).toBe(1);
    expect(await countIn('workouts', other.id)).toBe(1);
    expect((await profileOf(other.id))?.display_name).toBe('theirs');
  });

  it('clears the profile fields rather than the row, which has no delete policy', async () => {
    /*
     * `public.users` has select, insert and update policies for the owner and no
     * delete — so a delete would match nothing and succeed silently, leaving the
     * name and biometrics behind. ADR 0032 §4 chose clearing over widening RLS
     * for a demo button; this is that decision, asserted.
     */
    await furnish(user.id, 'mine again');
    await resetDemoData(user.client, user.id);

    const profile = await profileOf(user.id);
    expect(profile, 'the row should survive, emptied').not.toBeNull();
    expect(profile?.display_name).toBeNull();
    expect(profile?.bodyweight_kg).toBeNull();
    expect(profile?.diet_goal).toBeNull();
    // Settings are preferences about using the app, not training data — a reset
    // that moved somebody's timezone would be doing something nobody asked for.
    expect(profile?.timezone).not.toBeNull();
  });

  it('cannot be pointed at another user, even with their id', async () => {
    // The signature takes an id, so this asks the question directly: RLS, not
    // the argument, is what decides whose rows go.
    await furnish(other.id, 'theirs again');

    await resetDemoData(user.client, other.id);

    expect(await countIn('coach_notes', other.id)).toBeGreaterThan(0);
    expect((await profileOf(other.id))?.display_name).toBe('theirs again');
  });

  /*
   * MEASURED while writing these: replacing every `.eq('user_id', userId)` in
   * `resetDemoData` with a filter matching EVERY row leaves all four passing.
   *
   * That is the right answer rather than a gap in the suite, and it is worth
   * recording because it is easy to misread as one. The filters are redundant
   * under RLS — the module says so — so no test can tell them apart from their
   * absence. What the mutation actually demonstrates is the thing the control
   * rests on: the policy, not the argument, decides whose rows go, and a
   * `userId` pointed anywhere still empties only the caller.
   *
   * The filters stay because they make each statement say what it means and
   * because they are what fails loudly if a policy is ever loosened — at which
   * point this suite would start distinguishing them.
   */

  it('leaves the ledger alone, so a reset cannot refill the budget', async () => {
    /*
     * ADR 0032's Consequences, and the one deliberate omission. The weekly spend
     * is computed from `llm_calls` (ADR 0026), so clearing it would make this
     * button a way to reset the project's bill on demand.
     */
    const admin = adminClient();
    const { error } = await admin.from('llm_calls').insert({
      user_id: user.id,
      stage: 'chat',
      attempt: 1,
      status: 'ok',
      models_requested: ['test/model'],
    });
    if (error) throw new Error(error.message);

    await resetDemoData(user.client, user.id);

    expect(await countIn('llm_calls', user.id)).toBeGreaterThan(0);
    expect(RESET_TABLES as readonly string[]).not.toContain('llm_calls');
  });
});
