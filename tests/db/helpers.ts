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
/**
 * A raw Postgres connection, used only by `schema-invariants.test.ts` — the
 * catalogue tables it reads are not exposed through PostgREST, so the Supabase
 * client cannot answer "is RLS on for every table".
 *
 * Defaults to the local stack. To run against the hosted project instead, which
 * is what a workstation without Docker has to do, put the pooler connection
 * string in `.env.local`:
 *
 *   SUPABASE_DB_URL=postgresql://postgres.<project-ref>:<db-password>@<region>.pooler.supabase.com:6543/postgres?sslmode=verify-full
 *
 * Dashboard → Project Settings → Database → Connection string → URI. It is a
 * database password rather than an API key, so it is not interchangeable with
 * SUPABASE_SERVICE_ROLE_KEY and is not recoverable from the other values here.
 */
export const DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * A connection string with its password removed, safe to put in an error.
 *
 * INVARIANT: this fails CLOSED. It rebuilds the URL from parsed parts rather
 *            than substituting into the original, because `String.replace`
 *            with a regex that does not match returns the input UNCHANGED —
 *            which prints the password verbatim on exactly the malformed inputs
 *            the caller's error branches exist to explain. Measured before the
 *            change: the previous regex leaked on three of four malformed
 *            inputs, including a string truncated mid-password by a wrapped
 *            paste, which is the most common way to get there.
 *
 * AI-NOTE: SUPABASE_DB_URL is the database OWNER password. It bypasses RLS and
 *          PostgREST both and can run DDL, so it outranks the service role key.
 *          Do not "simplify" this back to a .replace() — helpers.test.ts pins
 *          the cases that would regress.
 */
export function redactDbUrl(url: string): string {
  const unparseable = '<SUPABASE_DB_URL — unparseable, not echoed>';

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return unparseable;
  }

  /*
   * A missing slash is not a parse error.  parses
   * happily — postgresql is a non-special scheme, so with only one slash the
   * whole authority lands in  and  comes back empty. The
   * password would then be echoed inside the path. An empty host means the
   * string was never a usable connection string, so say nothing about it.
   *
   * Found by helpers.test.ts, not by reading the code.
   */
  if (parsed.host === '') return unparseable;
  const user = parsed.username === '' ? '' : `${decodeURIComponent(parsed.username)}:***@`;
  return `${parsed.protocol}//${user}${parsed.host}${parsed.pathname}`;
}

export type Client = SupabaseClient<Database>;

/**
 * A signed-OUT client.
 *
 * WHY it exists: RLS and grants are two independent gates (ADR 0003), and a
 * test that only ever holds a signed-in session measures the first one. This is
 * how the second is measured.
 */
export function anonClient(): Client {
  return createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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

/**
 * Signs in as one of the seeded archetypes and returns an RLS-scoped client.
 *
 * WHY the password is a literal in the repository: it is a fixture, printed on
 * the sign-in page by design — docs/FRAMING.md, "a grader must be able to open
 * the app and look at it". It authenticates nothing outside a seeded database.
 *
 * AI-NOTE: this was copied into each test file that needed it. Keep it here —
 *          the failure message is the valuable half, because "could not sign
 *          in" almost always means the seed was not run rather than that
 *          anything under test is broken.
 */
export async function signInAsArchetype(email: string): Promise<TestUser> {
  const anon = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: 'samson-demo-fixture',
  });
  if (error || !data.session) {
    throw new Error(
      `could not sign in ${email} (${error?.message}). Run: npm run migrate && npm run seed`
    );
  }

  const client = createClient<Database>(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  return { id: data.session.user.id, email, client };
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  await adminClient().auth.admin.deleteUser(user.id);
}
