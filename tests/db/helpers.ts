/**
 * Fixture helpers for the DB suite.
 *
 * WHY: these tests use the service role key to *create* fixtures, which
 *      CLAUDE.md #10 permits — the invariant forbids bypassing RLS in
 *      application code, and tests/unit/invariants.test.ts asserts it never
 *      appears under src/ or app/. Every assertion below runs through a
 *      user-scoped client so RLS is what is actually being measured.
 */
import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/db/types';

config({ path: '.env.local', quiet: true });

export const SUPABASE_URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
export const ANON_KEY = process.env['SUPABASE_ANON_KEY'] ?? '';
export const SERVICE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';
export const DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

export type Client = SupabaseClient<Database>;

export function adminClient(): Client {
  return createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface TestUser {
  id: string;
  email: string;
  client: Client;
}

/**
 * The first request made with a freshly minted token, retried through a clock
 * disagreement between the service that issued it and the one validating it.
 *
 * WHY this exists: GoTrue mints the access token and PostgREST validates it. If
 * PostgREST's clock is a fraction of a second behind, the token's `iat` is in
 * its future and the request is rejected with "JWT issued at future". It is
 * transient — the same token works moments later — and it is not local clock
 * skew: measured against the project's own HTTP Date header, this machine is
 * within a second of the server.
 *
 * WHY it matters more than an ordinary flake: it lands on the very first
 * RLS-scoped call each fixture makes, inside `beforeAll`, so it fails the
 * whole FILE rather than one assertion. Observed roughly three times in a
 * dozen runs against the hosted project, every one of which passed on a plain
 * re-run — which is exactly the shape of failure that trains people to ignore
 * a red CI.
 *
 * Only this error is retried. Anything else fails immediately, because a
 * fixture that cannot be created is a real failure and burying it under
 * retries is how a suite stops meaning anything.
 */
export async function throughClockSkew(
  // PromiseLike, not Promise: a PostgrestFilterBuilder is thenable and is only
  // turned into a Promise by awaiting it.
  attempt: () => PromiseLike<{ error: { message: string } | null }>,
  describe: string
): Promise<void> {
  const attempts = 5;
  for (let n = 1; n <= attempts; n += 1) {
    const { error } = await attempt();
    if (!error) return;

    const transient = /issued at future|not yet valid/i.test(error.message);
    if (!transient || n === attempts) throw new Error(`${describe}: ${error.message}`);

    // Short and increasing: the skew being waited out is sub-second.
    await new Promise((resolve) => setTimeout(resolve, 200 * n));
  }
}

/** Creates an auth user, signs it in, and returns an RLS-scoped client. */
export async function createTestUser(label: string): Promise<TestUser> {
  const admin = adminClient();
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@samson.test`;
  const password = 'fixture-password-not-a-secret';

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create ${label}: ${error?.message}`);

  const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await anon.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) {
    throw new Error(`could not sign in ${label}: ${signIn.error?.message}`);
  }

  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signIn.data.session.access_token}` } },
  });

  await throughClockSkew(
    () => client.from('users').insert({ user_id: data.user.id, timezone: 'UTC' }),
    `could not create profile for ${label}`
  );

  return { id: data.user.id, email, client };
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  await adminClient().auth.admin.deleteUser(user.id);
}
