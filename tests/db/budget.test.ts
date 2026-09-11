/**
 * The weekly LLM budget belongs to the project, not to the user it limits —
 * ADR 0026, migrations 20260912090000 and 20260912090100.
 *
 * Every case runs through the user's own client, because the holes were all
 * reachable with the public anon key and a session: that is the attacker this
 * file is written against. The service role appears only where the project
 * itself is meant to be able to act.
 *
 * INVARIANT: the service role creates fixtures; every assertion about what a
 *            user can do runs through a user-scoped client — as in rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../src/db/types';
import { createSupabaseLedger } from '../../src/db/ledger';
import { SPEECH_ASSUMED_COST_USD, TIMEOUT_ASSUMED_COST_USD } from '../../src/llm/config';
import {
  ANON_KEY,
  SUPABASE_URL,
  adminClient,
  createTestUser,
  deleteTestUsers,
  throughClockSkew,
  type TestUser,
} from './helpers';

let user: TestUser;
let other: TestUser;

beforeAll(async () => {
  [user, other] = await Promise.all([createTestUser('budget'), createTestUser('budget-other')]);
}, 90_000);

afterAll(async () => {
  await deleteTestUsers(user, other);
});

const budgetOf = async (id: string) => {
  const { data, error } = await adminClient()
    .from('users')
    .select('llm_weekly_budget_usd')
    .eq('user_id', id)
    .single();
  if (error) throw new Error(error.message);
  return Number(data.llm_weekly_budget_usd);
};

/** One ledger row, as the gateway would write it. */
const ledgerRow = (as: TestUser, over: Record<string, unknown> = {}) => ({
  user_id: as.id,
  stage: 'smoke',
  attempt: 1,
  status: 'ok',
  models_requested: ['x/y'],
  latency_ms: 10,
  ...over,
});

describe('the ceiling', () => {
  it("refuses a user raising their own budget — ADR 0026's first hole", async () => {
    const { error } = await user.client
      .from('users')
      .update({ llm_weekly_budget_usd: 999_999 })
      .eq('user_id', user.id);

    expect(error, 'a user raised their own budget').not.toBeNull();
    expect(error!.message).toContain("not the user's to change");
    expect(await budgetOf(user.id)).toBe(0.5);
  });

  it('still lets a user change the settings that are theirs', async () => {
    // The trigger watches one column. A guard that also broke Settings would be
    // switched off, and then it would protect nobody.
    const { error } = await user.client
      .from('users')
      .update({ timezone: 'Europe/Berlin' })
      .eq('user_id', user.id);
    expect(error).toBeNull();
  });

  it('gives a profile a user creates the default budget, whatever the row asked for', async () => {
    // A user without a profile creates their own row, choosing the budget in it.
    const admin = adminClient();
    const email = `budget-fresh-${Date.now()}@samson.test`;
    const password = 'fixture-password-not-a-secret';
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(created.error?.message);
    const id = created.data.user.id;
    onTestFinished(async () => {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error(`deleting the fresh user: ${error.message}`);
    });

    const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.session) throw new Error(signIn.error?.message);
    const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${signIn.data.session.access_token}` } },
    });

    await throughClockSkew(
      () =>
        client.from('users').insert({ user_id: id, timezone: 'UTC', llm_weekly_budget_usd: 999 }),
      'could not create the fresh profile'
    );

    expect(await budgetOf(id)).toBe(0.5);
  });

  it('lets the project set a budget — the service role passes', async () => {
    const admin = adminClient();
    const { error } = await admin
      .from('users')
      .update({ llm_weekly_budget_usd: 2 })
      .eq('user_id', other.id);
    expect(error).toBeNull();
    expect(await budgetOf(other.id)).toBe(2);

    const reset = await admin
      .from('users')
      .update({ llm_weekly_budget_usd: 0.5 })
      .eq('user_id', other.id);
    expect(reset.error).toBeNull();
  });

  it('refuses NaN as a budget, even from the project', async () => {
    // `>= 0` admits NaN — Postgres sorts it above every number.
    const { error } = await adminClient()
      .from('users')
      .update({ llm_weekly_budget_usd: 'NaN' as unknown as number })
      .eq('user_id', other.id);
    expect(error, 'NaN became a budget').not.toBeNull();
    // Named, not merely "an error": the row is also watched by a trigger and by
    // `>= 0`, and a test that accepted any failure would pass if the CHECK this
    // migration adds were dropped.
    expect(error!.message).toContain('users_llm_budget_not_nan');
  });
});

describe('the ledger', () => {
  it('refuses a negative cost, which would cancel spend', async () => {
    const { error } = await user.client
      .from('llm_calls')
      .insert(ledgerRow(user, { cost_credits: -9999 }) as never);
    expect(error, 'a negative cost was recorded').not.toBeNull();
    // The constraint by name. RLS, the stage CHECK and a not-null all guard this
    // insert too, and "some error happened" would pass with this one gone.
    expect(error!.message).toContain('llm_calls_cost_credits_spent');
  });

  it('refuses a NaN cost, which would poison the sum', async () => {
    const { error } = await user.client
      .from('llm_calls')
      .insert(ledgerRow(user, { cost_credits: 'NaN' }) as never);
    expect(error, 'a NaN cost was recorded').not.toBeNull();
    expect(error!.message).toContain('llm_calls_cost_credits_spent');
  });

  it('refuses a NaN upstream cost too — the other priced column', async () => {
    // Asserted separately because one insert carrying both would stop at the
    // first constraint and say nothing about the second.
    const { error } = await user.client
      .from('llm_calls')
      .insert(ledgerRow(user, { upstream_cost: 'NaN' }) as never);
    expect(error, 'a NaN upstream cost was recorded').not.toBeNull();
    expect(error!.message).toContain('llm_calls_upstream_cost_spent');
  });

  it('dates a row by the database, not by its writer', async () => {
    const { data, error } = await user.client
      .from('llm_calls')
      .insert(ledgerRow(user, { created_at: '2099-01-01T00:00:00Z', cost_credits: 0 }) as never)
      .select('created_at')
      .single();
    expect(error).toBeNull();

    const written = new Date(data!.created_at).getTime();
    // Within an hour of now either way — a clock skew allowance, not 2099.
    expect(Math.abs(written - Date.now())).toBeLessThan(60 * 60 * 1000);
  });
});

describe('the sum', () => {
  it('counts real spend a thousand planted rows used to hide, and prices the unpriced', async () => {
    /*
     * ADR 0026's second hole, as it was exploited: the old sum fetched rows
     * and added them up in JavaScript, and PostgREST stops at 1,000 — so a
     * thousand zero-cost rows written after real spend pushed it out of the
     * sum. Summed in Postgres now, the flood adds nothing.
     */
    const spender = await createTestUser('budget-flood');
    onTestFinished(() => deleteTestUsers(spender));

    const real = [
      ledgerRow(spender, { cost_credits: 0.3 }),
      ledgerRow(spender, { status: 'timeout' }),
      ledgerRow(spender, { stage: 'speech', status: 'ok' }),
      ledgerRow(spender, { stage: 'speech', status: 'schema_invalid' }),
      // Charged nothing: no 200, and a text call with no reported cost.
      ledgerRow(spender, { stage: 'speech', status: 'http_error' }),
      ledgerRow(spender, { stage: 'chat', status: 'ok' }),
    ];
    const flood = Array.from({ length: 1_000 }, () => ledgerRow(spender, { cost_credits: 0 }));

    for (const batch of [real, flood]) {
      const { error } = await spender.client.from('llm_calls').insert(batch as never);
      expect(error).toBeNull();
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const spent = await createSupabaseLedger(spender.client).sumSpendSince(spender.id, weekAgo);

    expect(spent).toBeCloseTo(0.3 + TIMEOUT_ASSUMED_COST_USD + 2 * SPEECH_ASSUMED_COST_USD, 8);
  });

  it("counts none of another user's spend", async () => {
    const { error } = await other.client
      .from('llm_calls')
      .insert(ledgerRow(other, { cost_credits: 0.25 }) as never);
    expect(error).toBeNull();

    // Asked for the other user's id through this user's client: RLS scopes the
    // rows to the caller, so the answer is nothing rather than their spend.
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const seen = await createSupabaseLedger(user.client).sumSpendSince(other.id, weekAgo);
    expect(seen).toBe(0);
  });
});
