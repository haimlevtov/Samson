/**
 * Supabase clients.
 *
 * INVARIANT: RLS is on for every table, and application code never bypasses it
 *            with the service role key — CLAUDE.md #10.
 * WHY: there is deliberately no service-role client exported from this module.
 *      If a future task needs one (the phase 1 seeder is the expected case), it
 *      belongs in a script under scripts/, never on a request path.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../llm/config';
import type { Database } from './types';

export type Db = SupabaseClient<Database>;

function required(name: string, env: Env): string {
  const value = env[name];
  if (!value || value.trim() === '') {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

export function supabaseUrl(env: Env = process.env): string {
  return required('NEXT_PUBLIC_SUPABASE_URL', env);
}

export function supabaseAnonKey(env: Env = process.env): string {
  return required('NEXT_PUBLIC_SUPABASE_ANON_KEY', env);
}

/**
 * Unauthenticated client. RLS resolves auth.uid() to NULL, so this reaches only
 * rows that policies expose to the anon role — currently none.
 */
export function createAnonClient(env: Env = process.env): Db {
  return createClient<Database>(supabaseUrl(env), supabaseAnonKey(env), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Client bound to one user's access token. Every query runs under that user's
 * RLS policies, which is what makes the gateway's ledger writes safe.
 */
export function createUserClient(accessToken: string, env: Env = process.env): Db {
  return createClient<Database>(supabaseUrl(env), supabaseAnonKey(env), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
