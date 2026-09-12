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
import { resetDemoData } from '../../src/db/demo-reset';
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

/**
 * A throwaway account MARKED as a demo one.
 *
 * FOUND IN REVIEW, and the first version of this helper was itself the
 * vulnerability's open door: it deleted whoever held `fresh@samson.test` and
 * recreated it, and `helpers.ts` records that a workstation without Docker runs
 * this suite against the HOSTED project. So running the tests freed the address
 * the gate keyed on, for anybody who wanted to sign up as it.
 *
 * The gate is `raw_app_meta_data` now — service-role-only — so this fixture uses
 * a random address like every other test user and stamps the mark instead. The
 * canonical address is never touched.
 */
async function createDemoAccount(): Promise<{ id: string; client: Client }> {
  const admin = adminClient();
  const password = 'fixture-password-not-a-secret';
  const email = `reset-demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@samson.test`;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // The mark the function reads. A signed-in user cannot write this column.
    app_metadata: { demo_reset: true },
  });
  if (created.error || !created.data.user) {
    throw new Error(`creating the demo account: ${created.error?.message}`);
  }

  const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await anon.auth.signInWithPassword({ email, password });
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

  const { error: profileError } = await admin.from('users').upsert(
    {
      user_id: id,
      display_name: marker,
      bodyweight_kg: 80,
      diet_goal: 'gain',
      // Every onboarding ANSWER, because the reset's job is to make the flow
      // ask again — see the assertions below.
      persona_slug: 'old-master',
    },
    { onConflict: 'user_id' }
  );
  if (profileError) throw new Error(`users: ${profileError.message}`);

  await put('coach_notes', { text: `${marker} note` });
  /*
   * `challenges`, `sets`, `workout_templates` and `workout_template_items` were
   * all named to the user and none was furnished — FOUND IN REVIEW, and it is
   * the same gap class this file was rewritten to close. Deleting the matching
   * line from the function used to leave the suite green.
   */
  await put('challenges', {
    slug: `fixture-${marker.replace(/s+/gu, '-')}`,
    kind: 'weekly',
    spec: { target: 3 },
    status: 'offered',
    window_start: '2026-09-01',
    window_end: '2026-09-07',
  });
  const workout = await admin
    .from('workouts')
    .insert({ user_id: id, local_date: '2026-09-01', status: 'completed' })
    .select('id')
    .single();
  if (workout.error) throw new Error(`workouts: ${workout.error.message}`);

  // `sets` and `workout_templates` are named to the user too, and were the last
  // two the fixture did not reach — FOUND IN REVIEW, the same gap class twice.
  const { data: lift } = await admin.from('exercises').select('id').is('user_id', null).limit(1);
  if (lift?.[0]) {
    await put('sets', {
      workout_id: workout.data.id,
      exercise_id: lift[0].id,
      set_index: 1,
      reps: 5,
      weight_kg: 60,
    });
  }
  await put('workout_templates', { name: `fixture ${marker}`, source: 'user' });
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
  if (tag?.[0]) {
    // Upsert: the PK is (user_id, equipment_tag_id) and `furnish` runs more than
    // once per user. CI caught this where a local run did not, because the
    // seeded database it builds on reaches the second call.
    const { error } = await admin
      .from('user_equipment')
      .upsert(
        { user_id: id, equipment_tag_id: tag[0].id },
        { onConflict: 'user_id,equipment_tag_id' }
      );
    if (error) throw new Error(`user_equipment: ${error.message}`);
  }

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
    expect(await countIn('challenges', demo.id)).toBe(1);
    expect(await countIn('xp_events', demo.id)).toBe(1);

    await resetDemoData(demo.client);

    expect(await countIn('plan_runs', demo.id)).toBe(0);
    expect(await countIn('challenges', demo.id)).toBe(0);
    expect(await countIn('xp_events', demo.id)).toBe(0);
    expect(await countIn('achievement_events', demo.id)).toBe(0);
    expect(await countIn('coach_notes', demo.id)).toBe(0);
    expect(await countIn('workouts', demo.id)).toBe(0);
    expect(await countIn('sets', demo.id)).toBe(0);
    expect(await countIn('workout_templates', demo.id)).toBe(0);
    expect(await countIn('user_equipment', demo.id)).toBe(0);
  });

  it('refuses an unmarked account', async () => {
    await furnish(other.id, 'theirs');

    await expect(resetDemoData(other.client)).rejects.toThrow();
    expect(await countIn('coach_notes', other.id)).toBe(1);
    expect(await countIn('xp_events', other.id)).toBe(1);
  });

  it('refuses an account that marked ITSELF, which is the column a user can write', async () => {
    /*
     * The finding this test exists for, in the form that survives CI.
     *
     * The gate used to be `auth.users.email`, which a signed-up user chooses —
     * `enable_signup` is true and confirmations are off — so claiming the demo
     * address was enough to call a `security definer` function that deletes
     * `achievement_events`. That table's unique constraint is what makes a badge
     * once-only, so the reward was re-earning every badge and being paid its XP
     * again.
     *
     * It reads `raw_app_meta_data` now. The property that makes that a control
     * rather than a longer string is that a user CANNOT WRITE IT: the client
     * SDK's `updateUser` writes `raw_user_meta_data`, a different column. So the
     * sharpest assertion is an account carrying the mark in the column it can
     * reach, and a refusal anyway.
     *
     * WHY NOT an account holding the demo ADDRESS: it cannot be built where it
     * matters. CI seeds before this suite runs, so `fresh@samson.test` is
     * already held there — by the legitimate marked account. An earlier version
     * of this test deleted that holder to make room, which is precisely the door
     * the review found standing open, because a workstation without Docker runs
     * this suite against the HOSTED project.
     */
    const admin = adminClient();
    const impostor = await createTestUser('reset-impostor');

    const marked = await admin.auth.admin.updateUserById(impostor.id, {
      // The user-writable twin of the column the function reads.
      user_metadata: { demo_reset: true },
    });
    if (marked.error) throw new Error(`marking the impostor: ${marked.error.message}`);

    try {
      await furnish(impostor.id, 'impostor');
      await expect(resetDemoData(impostor.client)).rejects.toThrow();
      expect(await countIn('achievement_events', impostor.id)).toBe(1);
      expect(await countIn('coach_notes', impostor.id)).toBe(1);
    } finally {
      await deleteTestUsers(impostor);
    }
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
      .select('display_name, bodyweight_kg, diet_goal, persona_slug, onboarded_at, timezone')
      .eq('user_id', demo.id)
      .maybeSingle();

    expect(data?.display_name).toBeNull();
    expect(data?.bodyweight_kg).toBeNull();
    expect(data?.diet_goal).toBeNull();
    /*
     * The chosen coach, and the reason it is asserted beside the others rather
     * than trusted: a column `src/onboarding/steps.ts` reads to decide whether a
     * step is answered, left behind by the reset, silently shortens the flow the
     * reset exists to restore. That is not hypothetical — a surviving
     * `plan_runs` row did exactly this in PR 4, and the plan step was never
     * offered again.
     */
    expect(data?.persona_slug).toBeNull();
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
