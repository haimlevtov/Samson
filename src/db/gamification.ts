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

  // RLS scopes both to the caller — CLAUDE.md #10, no user_id filter to forget.
  const [{ data: week, error: weekErr }, { data: all, error: allErr }] = await Promise.all([
    db.from('xp_events').select('amount').eq('week_start', weekStart),
    db.from('xp_events').select('amount'),
  ]);

  if (weekErr) throw new Error(`loading weekly xp: ${weekErr.message}`);
  if (allErr) throw new Error(`loading lifetime xp: ${allErr.message}`);

  const thisWeek = (week ?? []).reduce((sum, row) => sum + row.amount, 0);

  return {
    thisWeek,
    remainingThisWeek: Math.max(0, WEEKLY_XP_CEILING - thisWeek),
    ceiling: WEEKLY_XP_CEILING,
    lifetime: (all ?? []).reduce((sum, row) => sum + row.amount, 0),
  };
}

/**
 * Badges this user holds.
 *
 * AI-NOTE: hidden achievement DEFINITIONS are withheld by the
 *          `achievements_read_visible` policy, so a hidden badge the user has
 *          unlocked joins to nothing and its name comes back null. That is the
 *          policy working, not a bug — phase 5 owns deciding what a held hidden
 *          badge should look like. Until then it is filtered out rather than
 *          rendered as a blank card.
 */
export async function loadUnlockedAchievements(db: Db): Promise<UnlockedAchievement[]> {
  const { data, error } = await db
    .from('achievement_events')
    .select('unlocked_at, local_date, achievements (slug, name, description, tier, source_hint)')
    .order('unlocked_at', { ascending: false });

  if (error) throw new Error(`loading achievements: ${error.message}`);

  return (data ?? []).flatMap((row) => {
    const a = row.achievements;
    if (a === null) return [];
    return [
      {
        slug: a.slug,
        name: a.name,
        description: a.description,
        tier: a.tier,
        sourceHint: a.source_hint,
        unlockedAt: row.unlocked_at,
        localDate: row.local_date,
      },
    ];
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
