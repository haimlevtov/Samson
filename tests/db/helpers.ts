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

export const SUPABASE_URL = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
export const ANON_KEY = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? '';
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

  const profile = await client.from('users').insert({ user_id: data.user.id, timezone: 'UTC' });
  if (profile.error)
    throw new Error(`could not create profile for ${label}: ${profile.error.message}`);

  return { id: data.user.id, email, client };
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  await adminClient().auth.admin.deleteUser(user.id);
}
