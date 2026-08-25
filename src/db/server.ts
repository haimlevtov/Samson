/**
 * Request-scoped Supabase clients for the Next.js server.
 *
 * INVARIANT: RLS is on for every table and application code never bypasses it
 *            with the service role key — CLAUDE.md #10.
 *
 * WHY every read and write in app/ goes through this: the client it returns
 * carries the signed-in user's access token, so Postgres itself decides which
 * rows are reachable. Nothing in the request path needs to remember to add a
 * `where user_id = ...`, and forgetting one cannot leak another user's data.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Db } from './client';
import { supabaseAnonKey, supabaseUrl } from './client';
import type { Database } from './types';

/** Bound to the caller's session cookies. Never cache this across requests. */
export async function createServerDb(): Promise<Db> {
  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies. The middleware refreshes the
          // session instead, so this is safe to ignore rather than a failure.
        }
      },
    },
  }) as unknown as Db;
}

export interface SessionUser {
  id: string;
  email: string | null;
  displayName: string | null;
  timezone: string;
  unitPreference: string;
}

/**
 * The signed-in user and their profile, or null.
 *
 * WHY getUser() rather than getSession(): getSession reads the cookie without
 * verifying it, so a forged cookie would pass. getUser revalidates against the
 * auth server. On a page that decides what a user may see, that difference is
 * the whole point.
 */
export async function currentUser(db: Db): Promise<SessionUser | null> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const { data: profile } = await db
    .from('users')
    .select('display_name, timezone, unit_preference')
    .eq('user_id', user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? null,
    displayName: profile?.display_name ?? null,
    timezone: profile?.timezone ?? 'UTC',
    unitPreference: profile?.unit_preference ?? 'metric',
  };
}

/**
 * Today in the user's own timezone.
 *
 * INVARIANT: timestamps are UTC plus the user's IANA timezone, and calendar
 *            logic evaluates against the user's local date — CLAUDE.md #9.
 * WHY here rather than at each call site: a session started at 23:30 in
 * Jerusalem belongs to that day, not to whatever date the server is on.
 */
export function localDateFor(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
