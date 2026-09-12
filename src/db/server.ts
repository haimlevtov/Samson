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
import { localDateIn } from '../metrics/dates';
import type { Db } from './client';
import { supabaseAnonKey, supabaseUrl } from './client';
import type { Database } from './types';
import { isSex, type Sex } from '../diet/biometrics';

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
  /**
   * The user's own ceiling on persona humour — ADR 0006. Read here rather than
   * inside the persona stage so the stage stays a pure function of its inputs
   * and can be tested without a database.
   */
  humorMaxLevel: string;
  /** ADR 0016 §4. Default is visible; this is the way out. */
  leaderboardOptOut: boolean;
  /** Appearance — see src/ui/theme.ts. The layout stamps it onto <html>. */
  theme: string;
  /**
   * The four the diet advisor needs — ADR 0024, docs/specs/diet.md §1.
   *
   * INVARIANT: kilograms and centimetres, canonically — CLAUDE.md #8.
   *
   * Null is a real state and not a missing default: every one of them may be
   * cleared, and `src/diet/` names the absent field rather than guessing one.
   * They are read here and consumed by the energy engine; none of them is ever
   * put in a payload sent to a model — ADR 0024 §5.
   */
  bodyweightKg: number | null;
  heightCm: number | null;
  /** ISO `YYYY-MM-DD`. Age is derived against the user's local date — #9. */
  birthDate: string | null;
  /**
   * Narrowed from the column's `text` by `isSex`, not cast. A value outside the
   * three means the CHECK is gone, and reading it as valid would feed an unknown
   * string into the Mifflin constant lookup. Null is the safe read: it produces
   * the missing-biometric refusal, which is visible, rather than a silent
   * default.
   */
  sex: Sex | null;
  /** The stored diet goal, or null when the user has not chosen — ADR 0032 §3. */
  dietGoal: string | null;
  /**
   * The coach the user picked in onboarding, or null — rework PR 8, ADR 0031 §5.
   *
   * NOT validated against the persona rows here, deliberately: a round trip to
   * the content table on every request, to turn a live slug into the same live
   * slug, would be paid by every page. A slug naming no listed coach is a real
   * state, and `src/persona/choice.ts` is where it is handled.
   */
  personaSlug: string | null;
  /**
   * When the welcome flow was finished, or null — ADR 0032 §2 as amended.
   *
   * The ONE thing onboarding stores that is not derivable from the data. Which
   * step to show still comes from what is there; whether the flow has ever been
   * completed comes from nowhere else, and deriving it from the display name
   * bounced anybody who cleared their name straight back into it.
   */
  onboardedAt: string | null;
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
    .select(
      'display_name, timezone, unit_preference, humor_max_level, theme, leaderboard_opt_out, bodyweight_kg, height_cm, birth_date, sex, diet_goal, persona_slug, onboarded_at'
    )
    .eq('user_id', user.id)
    .maybeSingle();

  const storedSex = profile?.sex ?? null;

  /*
   * Null means "has not chosen" and is not the same as "chose maintain" — ADR
   * 0032 §3. Readers still fall back (`normaliseGoal` lands on maintain), so
   * nothing changes behaviour; what the null buys is that onboarding can tell
   * the question is still open, and the Coach tab can show the answer somebody
   * actually gave.
   */
  const storedGoal = profile?.diet_goal ?? null;

  return {
    id: user.id,
    email: user.email ?? null,
    displayName: profile?.display_name ?? null,
    timezone: profile?.timezone ?? 'UTC',
    unitPreference: profile?.unit_preference ?? 'metric',
    // 'cheeky' is the column default; the fallback matches it so a missing
    // profile row behaves the same as a default one.
    humorMaxLevel: profile?.humor_max_level ?? 'cheeky',
    // Falls back to VISIBLE, matching the column default. A missing profile row
    // must not silently opt somebody out of a feature they never saw.
    leaderboardOptOut: profile?.leaderboard_opt_out ?? false,
    theme: profile?.theme ?? 'system',
    // `?? null` rather than a default: absent is the answer here, and the diet
    // block says which field it is waiting for.
    bodyweightKg: profile?.bodyweight_kg ?? null,
    heightCm: profile?.height_cm ?? null,
    birthDate: profile?.birth_date ?? null,
    // Narrowed from the column's `text`. The CHECK admits exactly these three;
    // anything else means the constraint was dropped, and null is the safe read.
    sex: isSex(storedSex) ? storedSex : null,
    dietGoal: storedGoal,
    personaSlug: profile?.persona_slug ?? null,
    onboardedAt: profile?.onboarded_at ?? null,
  };
}

/**
 * Today in the user's own timezone, for the request path.
 *
 * INVARIANT: timestamps are UTC plus the user's IANA timezone, and calendar
 *            logic evaluates against the user's local date — CLAUDE.md #9.
 * WHY here rather than at each call site: a session started at 23:30 in
 * Jerusalem belongs to that day, not to whatever date the server is on.
 *
 * FOUND IN REVIEW: this was a second definition. It is now the app's name for
 * `localDateIn`, which the batch scripts share — they cannot import this
 * module at all, because it reaches for `next/headers`.
 */
export function localDateFor(timezone: string, now: Date = new Date()): string {
  return localDateIn(timezone, now);
}
