/**
 * Which pool templates become this user's challenges, and with what window.
 *
 * WHY this is a module and not a loop inside `scripts/generate-challenges.ts`,
 * where it used to live: two callers now assign. The weekly cron does it for
 * real users, and `scripts/seed.ts` does it for the demo archetypes. Two copies
 * of "what gets offered" would drift, and the seeder's copy would drift
 * SILENTLY — nobody reads a demo database closely enough to notice that it
 * stopped agreeing with production. It is the same reasoning that keeps
 * `evaluateChallenge` shared between the batch and the Hub.
 *
 * INVARIANT: pure. No database, no clock, no randomness — `asOf` comes in on
 *            the context. That is what lets the seeded outcome be asserted
 *            offline, on every weekday, without a Postgres.
 *
 * Contract: `docs/specs/xp-and-challenges.md`.
 */
import { addDays } from '../metrics/dates';
import type { LocalDate } from '../metrics/types';
import {
  challengeSpecSchema,
  validateCandidate,
  type ChallengeContext,
  type ChallengeKind,
  type ChallengeSpec,
  type ValidationReason,
} from './challenge';

/**
 * One unassigned row from the pool — `challenges` with a null `user_id`.
 *
 * `spec` is `unknown` on purpose. It arrives from a jsonb column, so it is
 * untrusted input like any other and is parsed here rather than by the caller;
 * a row written by an older generator must not crash a batch that touches every
 * user.
 */
export interface PoolTemplate {
  slug: string;
  kind: ChallengeKind;
  spec: unknown;
}

/** A row to write, already decided. */
export interface Assignment {
  slug: string;
  kind: ChallengeKind;
  spec: ChallengeSpec;
  status: 'offered' | 'rejected';
  /** Today. The window a challenge is FOR runs forward from here. */
  windowStart: LocalDate;
  windowEnd: LocalDate;
  /** Empty for an offered one; why not, for a rejected one. */
  reasons: ValidationReason[];
}

/** Why a template produced no row at all, as opposed to a rejected one. */
export type SkipReason = 'already_assigned' | 'unparseable_spec';

export interface AssignmentPlan {
  assignments: Assignment[];
  /**
   * Templates that produced nothing.
   *
   * WHY these are returned rather than logged here: a pure function that prints
   * is a pure function nobody can test the output of. The cron prints them, the
   * seeder counts them, and a test can assert on them.
   */
  skipped: { slug: string; reason: SkipReason }[];
}

/**
 * Decides what to write for one user.
 *
 * The window runs FORWARD from `asOf` while `validateCandidate` looks BACKWARD
 * from it. That is deliberate and is the whole shape of the feature: the
 * question asked is "do you already do this?", and the answer decides whether
 * to offer it for the days ahead.
 *
 * AI-NOTE: `alreadyAssigned` is by slug, so a user is never offered the same
 *          template twice — including one they rejected or completed weeks ago.
 *          That is the existing behaviour, kept: re-offering a challenge whose
 *          rejection reasons are still on screen would make the Hub's "not
 *          offered" list contradict itself.
 */
export function assignFromPool(
  pool: readonly PoolTemplate[],
  context: ChallengeContext,
  alreadyAssigned: Iterable<string>
): AssignmentPlan {
  const owned = new Set(alreadyAssigned);
  const assignments: Assignment[] = [];
  const skipped: { slug: string; reason: SkipReason }[] = [];

  for (const template of pool) {
    if (owned.has(template.slug)) {
      skipped.push({ slug: template.slug, reason: 'already_assigned' });
      continue;
    }

    const parsed = challengeSpecSchema.safeParse(template.spec);
    if (!parsed.success) {
      skipped.push({ slug: template.slug, reason: 'unparseable_spec' });
      continue;
    }

    const verdict = validateCandidate(parsed.data, template.kind, context);
    assignments.push({
      slug: template.slug,
      kind: template.kind,
      spec: parsed.data,
      status: verdict.ok ? 'offered' : 'rejected',
      windowStart: context.asOf,
      // Inclusive of both ends: a 1-day window opens and closes today, which is
      // what makes `window_days: 1` a daily quest rather than a two-day one.
      windowEnd: addDays(context.asOf, parsed.data.window_days - 1),
      reasons: verdict.reasons,
    });
  }

  return { assignments, skipped };
}
