/**
 * Reads for the progress surfaces, and the one write path.
 *
 * INVARIANT: no completion can be granted from the client — ADR 0009. Every
 *            function here that changes anything goes through
 *            `award_session_xp`, which takes a workout id and derives the rest.
 *            There is no insert into `xp_events` or `achievement_events` in
 *            this file, and RLS would refuse one anyway.
 *
 * Nothing here computes a number that `src/gamification/` could compute.
 * Aggregation that Postgres does better (a sum over a week) is done in the
 * query; anything that is a *rule* stays in the engine.
 */
import type { Db } from './client';
import { startOfWeek } from '../metrics/dates';
import { WEEKLY_XP_CEILING } from '../gamification/xp';
import { challengeSpecSchema, type ChallengeSpec } from '../gamification/challenge';
import { buildCatalogue, humorCeiling, type Catalogue } from '../gamification/catalogue';
import type { LocalDate } from '../metrics/types';

export interface XpSummary {
  /** Earned in the week containing `asOf`. */
  thisWeek: number;
  /** What is still available this week, never negative. */
  remainingThisWeek: number;
  ceiling: number;
  lifetime: number;
}

export interface UnlockedAchievement {
  slug: string;
  name: string;
  description: string;
  tier: string;
  /**
   * True for a badge whose definition is withheld until it is earned. The
   * surface marks it; nothing else branches on it.
   */
  hidden: boolean;
  sourceHint: string | null;
  unlockedAt: string;
  localDate: string;
}

export interface AssignedChallenge {
  id: string;
  slug: string;
  kind: 'daily' | 'weekly';
  status: string;
  spec: ChallengeSpec | null;
  validationReasons: { code: string; detail: string }[];
  windowStart: string | null;
  windowEnd: string | null;
}

/**
 * XP totals for the progress screen.
 *
 * WHY `week_start` is compared rather than a date range: the column is stored
 * at write time from the user's local date, so a user who changes timezone
 * cannot move XP between weeks and reopen a spent ceiling. Reading by the same
 * key is what keeps that guarantee visible.
 */
export async function loadXpSummary(db: Db, asOf: LocalDate): Promise<XpSummary> {
  const weekStart = startOfWeek(asOf);

  /*
   * Both sums are computed by Postgres — see migration 20260902100200.
   *
   * WHY not `select('amount')` and a reduce, which is what this used to do:
   * PostgREST caps a response at 1000 rows by default, so a lifetime total
   * added up in JavaScript silently truncates to the first page once a user has
   * more events than that. No error, no warning — just a number that quietly
   * stops growing and under-reports for the rest of the account's life.
   *
   * RLS scopes the function to the caller (CLAUDE.md #10), so there is still no
   * user_id filter to forget.
   */
  const { data, error } = await db.rpc('xp_totals', { p_week_start: weekStart });
  if (error) throw new Error(`loading xp totals: ${error.message}`);

  // A set-returning function comes back as rows; there is exactly one.
  const totals = data?.[0];
  const thisWeek = totals?.this_week ?? 0;

  return {
    thisWeek,
    remainingThisWeek: Math.max(0, WEEKLY_XP_CEILING - thisWeek),
    ceiling: WEEKLY_XP_CEILING,
    lifetime: totals?.lifetime ?? 0,
  };
}

/**
 * Badges this user holds, hidden ones included.
 *
 * WHY an RPC rather than a join: `achievements_read_visible` withholds every
 * hidden DEFINITION — that is the phase 5 criterion and it is not being
 * relaxed. A join through the user's own session therefore returned null for a
 * hidden badge the user had already earned, and this function used to drop it,
 * so unlocking one showed nothing at all. `unlocked_achievements()` is a
 * definer function scoped to `auth.uid()` with no parameter, returning only
 * rows the caller already holds an unlock event for — migration 20260908090100
 * carries the argument for why that leaks nothing.
 *
 * AI-NOTE: do not "simplify" this back to a PostgREST join. It typechecks, it
 *          passes every unit test, and it silently loses the hidden badges.
 */
export async function loadUnlockedAchievements(db: Db): Promise<UnlockedAchievement[]> {
  const { data, error } = await db.rpc('unlocked_achievements');

  if (error) throw new Error(`loading achievements: ${error.message}`);

  return (data ?? []).map((row) => ({
    slug: row.slug,
    name: row.name,
    description: row.description,
    tier: row.tier,
    hidden: row.hidden,
    sourceHint: row.source_hint,
    unlockedAt: row.unlocked_at,
    localDate: row.local_date,
  }));
}

/**
 * Every badge this user may see, shaped for `/badges` — ADR 0017's 2026-09-12
 * amendment.
 *
 * Three reads, and none of them relaxes anything:
 *
 * - the SHARED visible rows, through `achievements_read_visible` — which is what
 *   keeps a locked hidden badge out of the response;
 * - what the user holds, through `unlocked_achievements()`, as Profile reads it;
 * - how many hidden badges are left, as one integer.
 *
 * INVARIANT: the select list is explicit and never contains `predicate` — the
 *            policy grants the ROW, and that column is the SQL the evaluator
 *            runs (ADR 0009). `tests/unit/invariants.test.ts` fails on a
 *            `select('*')` or a `predicate` in any read of `achievements`.
 *
 * WHY `user_id is null`: a user-owned achievement's predicate is never executed
 * (ADR 0009 §3), so it can never be earned, and listing it with instructions
 * would be a promise the evaluator does not keep.
 */
export async function loadBadgeCatalogue(db: Db, humorMaxLevel: string): Promise<Catalogue> {
  const [visible, held, remaining] = await Promise.all([
    db
      .from('achievements')
      .select('slug, name, how_to_earn, tier, humor_level')
      .is('user_id', null),
    loadUnlockedAchievements(db),
    db.rpc('hidden_achievements_remaining'),
  ]);

  if (visible.error) throw new Error(`loading badges: ${visible.error.message}`);
  if (remaining.error) throw new Error(`counting hidden badges: ${remaining.error.message}`);

  return buildCatalogue({
    visible: (visible.data ?? []).map((row) => ({
      slug: row.slug,
      name: row.name,
      // Required on shared rows by `achievements_shared_rows_say_how_to_earn`;
      // the type cannot know that, and an empty string renders as a gap rather
      // than as "null".
      howToEarn: row.how_to_earn ?? '',
      tier: row.tier,
      humorLevel: row.humor_level,
    })),
    held,
    hiddenRemaining: remaining.data ?? 0,
    humorCeiling: humorCeiling(humorMaxLevel),
  });
}

/**
 * This user's assigned challenges, including rejected ones.
 *
 * WHY rejected challenges are returned rather than filtered out: PLAN.md phase
 * 4 requires that a rejected challenge is inspectable. A row nobody can see is
 * not inspectable, so the surface renders them with their reasons.
 */
export async function loadChallenges(db: Db): Promise<AssignedChallenge[]> {
  const { data, error } = await db
    .from('challenges')
    .select('id, slug, kind, status, spec, validation_reasons, window_start, window_end')
    .not('user_id', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`loading challenges: ${error.message}`);

  return (data ?? []).map((row) => {
    // Validated on READ as well as on write: a row written by an older version
    // of the generator is untrusted input like anything else out of the
    // database. A bad spec renders as null rather than crashing the page.
    const parsed = challengeSpecSchema.safeParse(row.spec);

    return {
      id: row.id,
      kind: row.kind as 'daily' | 'weekly',
      slug: row.slug,
      status: row.status,
      spec: parsed.success ? parsed.data : null,
      validationReasons: Array.isArray(row.validation_reasons)
        ? (row.validation_reasons as { code: string; detail: string }[])
        : [],
      windowStart: row.window_start,
      windowEnd: row.window_end,
    };
  });
}

export interface AwardResult {
  awarded: number;
  unlocked: string[];
}

/**
 * The only write path — ADR 0009.
 *
 * INVARIANT: takes a workout id and nothing else. Do not add an amount
 *            parameter, a source parameter, or a user id: each of those would
 *            move a decision the server makes into the caller's hands, and the
 *            caller is a browser.
 */
export async function awardSessionXp(db: Db, workoutId: string): Promise<AwardResult> {
  const { data, error } = await db.rpc('award_session_xp', { p_workout_id: workoutId });

  if (error) throw new Error(`awarding session xp: ${error.message}`);

  const result = data as { awarded?: number; unlocked?: string[] } | null;
  return {
    awarded: result?.awarded ?? 0,
    unlocked: result?.unlocked ?? [],
  };
}

/**
 * Puts a challenge in play.
 *
 * INVARIANT: this is the only way a challenge leaves `offered`, and it goes
 *            through a definer function because `challenges` has read-only RLS
 *            — ADR 0009. It carries a challenge id and nothing else: no
 *            progress, no claim that anything was met. Whether a challenge was
 *            COMPLETED is still derived from logged rows by the weekly batch.
 *
 * Returns false when nothing was accepted — someone else's challenge, one
 * already accepted, or one whose window has closed. The RPC does not
 * distinguish them on purpose: the caller is a browser, and "that is not yours"
 * and "that has expired" are the same answer from here.
 */
export async function acceptChallenge(db: Db, challengeId: string): Promise<boolean> {
  const { data, error } = await db.rpc('accept_challenge', { p_challenge_id: challengeId });
  if (error) throw new Error(`accepting challenge: ${error.message}`);
  return data === true;
}
