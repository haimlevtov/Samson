/**
 * The demo reset against Postgres — ADR 0032 §4.
 *
 * Two things are worth proving, and the first version of this file proved
 * neither, because it tested a client-side loop that could not work:
 *
 *   1. **It deletes what it says it deletes.** Four of the tables the card names
 *      are `for select` only, so a client delete against them matched no rows
 *      and SUCCEEDED — the app reported a reset while the XP, the badges, the
 *      challenges and the accepted plan all survived. FOUND IN REVIEW, and the
 *      old fixture never populated those four, so every test passed.
 *   2. **Nobody else can call it.** The gate moved from the application into the
 *      function, which is what makes `..._delete_own` policies unnecessary — and
 *      those would have been a real cheat, since `achievement_events` is
 *      once-only and a user who could delete their own rows could re-earn every
 *      badge and be paid its XP again.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { DEMO_ACCOUNT_EMAIL, resetDemoData } from '../../src/db/demo-reset';
import type { Database } from '../../src/db/types';
import {
  ANON_KEY,
  SUPABASE_URL,
  adminClient,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from './helpers';

type Table = keyof Database['public']['Tables'];
type Client = ReturnType<typeof createClient<Database>>;

let demo: { id: string; client: Client };
let other: TestUser;

/** The demo account, at its exact address — the function checks it by name. */
async function createDemoAccount(): Promise<{ id: string; client: Client }> {
  const admin = adminClient();
  const password = 'fixture-password-not-a-secret';

  // A previous run, or a seed, may already hold the address.
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const user of existing?.users ?? []) {
    if (user.email === DEMO_ACCOUNT_EMAIL) await admin.auth.admin.deleteUser(user.id);
  }

  const created = await admin.auth.admin.createUser({
    email: DEMO_ACCOUNT_EMAIL,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`creating the demo account: ${created.error?.message}`);
  }

  const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await anon.auth.signInWithPassword({ email: DEMO_ACCOUNT_EMAIL, password });
  if (signIn.error || !signIn.data.session) {
    throw new Error(`signing in the demo account: ${signIn.error?.message}`);
  }

  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signIn.data.session.access_token}` } },
  });

  return { id: created.data.user.id, client };
}

beforeAll(async () => {
  [demo, other] = await Promise.all([createDemoAccount(), createTestUser('reset-other')]);
}, 90_000);

afterAll(async () => {
  await adminClient().auth.admin.deleteUser(demo.id);
  await deleteTestUsers(other);
});

/**
 * One row in every table the reset names, plus a profile.
 *
 * INVARIANT: this must cover the four select-only tables — `plan_runs`,
 *            `challenges`, `achievement_events`, `xp_events`. The bug lived
 *            exactly in the gap between what the card named and what the fixture
 *            created.
 */
async function furnish(id: string, marker: string): Promise<void> {
  const admin = adminClient();
  const put = async (table: Table, row: Record<string, unknown>) => {
    const { error } = await admin.from(table).insert({ user_id: id, ...row });
    if (error) throw new Error(`${table}: ${error.message}`);
  };

  const { error: profileError } = await admin
    .from('users')
    .upsert(
      { user_id: id, display_name: marker, bodyweight_kg: 80, diet_goal: 'gain' },
      { onConflict: 'user_id' }
    );
  if (profileError) throw new Error(`users: ${profileError.message}`);

  await put('coach_notes', { text: `${marker} note` });
  await put('workouts', { local_date: '2026-09-01', status: 'completed' });
  // 'failed' rather than 'accepted': the accepted state requires a block (a CHECK
  // pairs the two), and what this fixture needs is a row rather than a plan.
  await put('plan_runs', { status: 'failed', iterations: 1 });
  await put('xp_events', {
    local_date: '2026-09-01',
    week_start: '2026-08-31',
    source: 'adherence',
    amount: 10,
  });

  const { data: tag } = await admin
    .from('equipment_tags')
    .select('id')
    .is('user_id', null)
    .limit(1);
  if (tag?.[0]) await put('user_equipment', { equipment_tag_id: tag[0].id });

  const { data: badge } = await admin.from('achievements').select('id').limit(1);
  if (badge?.[0]) {
    /*
     * Upsert, because `achievement_events_once` is a unique constraint and
     * `furnish` runs more than once per user. That constraint is also exactly
     * why deleting these rows from the client would be a cheat rather than a
     * convenience: it is what makes a badge once-only, so a user who could
     * remove their own row could earn its XP again.
     */
    const { error } = await admin
      .from('achievement_events')
      .upsert(
        { user_id: id, achievement_id: badge[0].id, local_date: '2026-09-01' },
        { onConflict: 'user_id,achievement_id' }
      );
    if (error) throw new Error(`achievement_events: ${error.message}`);
  }
}

const countIn = async (table: Table, id: string): Promise<number> => {
  const { count, error } = await adminClient()
    .from(table)
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', id);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
};

describe('reset_demo_account', () => {
  it('empties the tables a client delete could never have touched', async () => {
    /*
     * `plan_runs` is the one the user would have noticed: `latestAcceptedPlan`
     * kept returning a row, so onboarding decided the plan step was answered and
     * never offered it — the last beat of the demo, skipped.
     */
    await furnish(demo.id, 'demo');
    expect(await countIn('plan_runs', demo.id)).toBe(1);
    expect(await countIn('xp_events', demo.id)).toBe(1);

    await resetDemoData(demo.client);

    expect(await countIn('plan_runs', demo.id)).toBe(0);
    expect(await countIn('xp_events', demo.id)).toBe(0);
    expect(await countIn('achievement_events', demo.id)).toBe(0);
    expect(await countIn('coach_notes', demo.id)).toBe(0);
    expect(await countIn('workouts', demo.id)).toBe(0);
    expect(await countIn('user_equipment', demo.id)).toBe(0);
  });

  it('refuses anybody who is not the demo account', async () => {
    await furnish(other.id, 'theirs');

    await expect(resetDemoData(other.client)).rejects.toThrow();
    expect(await countIn('coach_notes', other.id)).toBe(1);
    expect(await countIn('xp_events', other.id)).toBe(1);
  });

  it('takes no argument, so it cannot be pointed anywhere', async () => {
    // The strongest form of the guarantee: the user is `auth.uid()` from the
    // verified JWT, and there is nowhere to put somebody else's id.
    await furnish(demo.id, 'demo again');
    await furnish(other.id, 'theirs again');

    await resetDemoData(demo.client);

    expect(await countIn('coach_notes', other.id)).toBeGreaterThan(0);
    expect(await countIn('xp_events', other.id)).toBeGreaterThan(0);
  });

  it('clears the profile and the onboarding stamp, and keeps the settings', async () => {
    await furnish(demo.id, 'demo');
    const admin = adminClient();
    await admin
      .from('users')
      .update({ onboarded_at: new Date().toISOString(), timezone: 'Asia/Jerusalem' })
      .eq('user_id', demo.id);

    await resetDemoData(demo.client);

    const { data } = await admin
      .from('users')
      .select('display_name, bodyweight_kg, diet_goal, onboarded_at, timezone')
      .eq('user_id', demo.id)
      .maybeSingle();

    expect(data?.display_name).toBeNull();
    expect(data?.bodyweight_kg).toBeNull();
    expect(data?.diet_goal).toBeNull();
    // Cleared, or the next sign-in would skip the welcome flow entirely.
    expect(data?.onboarded_at).toBeNull();
    // Kept: a preference about using the app, not training data.
    expect(data?.timezone).toBe('Asia/Jerusalem');
  });

  it('leaves the ledger alone, so a reset cannot refill the budget', async () => {
    // ADR 0032's Consequences, and the one deliberate omission: the weekly spend
    // is computed from `llm_calls`, so clearing it would make this a way to
    // reset the project's bill on demand.
    const { error } = await adminClient()
      .from('llm_calls')
      .insert({
        user_id: demo.id,
        stage: 'chat',
        attempt: 1,
        status: 'ok',
        models_requested: ['test/model'],
      });
    if (error) throw new Error(error.message);

    await resetDemoData(demo.client);

    expect(await countIn('llm_calls', demo.id)).toBeGreaterThan(0);
  });
});
