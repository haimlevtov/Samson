/**
 * Challenge settlement — which assigned challenges are finished, and what each
 * one pays.
 *
 * WHY this is a separate module from `challenge.ts`: that file answers "is this
 * worth offering" and "how far along is this". Settlement is the third
 * question — "given the week's ledger, what does finishing it actually pay" —
 * and it is the only one that has to know about the XP ceiling. Keeping it here
 * means `evaluateChallenge` stays a pure statement about progress.
 *
 * INVARIANT: completion is derived from logged rows, never submitted — ADR 0009.
 *            Nothing here reads a claim about what the user did. It calls
 *            `evaluateChallenge`, the same function the progress surface calls,
 *            so there is exactly one definition of what completing a challenge
 *            means.
 *
 * AI-NOTE: this runs in a batch job with the service role, NOT in a request.
 *          See ADR 0009 §4 for why: an RPC that paid out on the caller's word
 *          would let any signed-in client grant itself `reward_xp`, which is
 *          the phase 4 criterion "no completion can be granted from the client"
 *          failing outright. If you move this into a server action, you have to
 *          solve that first.
 */
import { evaluateChallenge, type ChallengeContext, type ChallengeSpec } from './challenge';
import { applyCeiling } from './xp';

export interface AssignedChallenge {
  id: string;
  slug: string;
  spec: ChallengeSpec;
  status: string;
}

export interface ChallengeSettlement {
  id: string;
  slug: string;
  progress: number;
  target: number;
  /** What the spec promises. */
  rewardXp: number;
  /** What the week can actually pay, which may be less and may be zero. */
  awardXp: number;
}

/**
 * Only an ACCEPTED challenge settles.
 *
 * INVARIANT: accepting is what puts a challenge in play — see the lifecycle
 *            table in docs/specs/xp-and-challenges.md. This set used to include
 *            `offered`, which meant a challenge paid out whether or not the user
 *            ever accepted it, and made the Hub's Accept control a button that
 *            changed nothing.
 *
 * A `rejected` challenge was never offered, and a `completed` or `failed` one
 * has already been resolved — re-settling either would pay twice.
 *
 * AI-NOTE: the UPDATE in scripts/generate-challenges.ts filters on the same
 *          statuses. Widen one and you must widen the other, or the batch pays
 *          for a challenge this function did not settle.
 */
const SETTLEABLE = new Set(['active']);

/**
 * The challenges finished as of `context.asOf`, with what each pays.
 *
 * `awardedThisWeek` is the user's existing XP for the week the settlement lands
 * in. The ceiling is applied cumulatively across the batch, so a user who
 * finishes four challenges at once cannot be paid past the cap by the fact that
 * each one individually fitted.
 *
 * A challenge that completes into an exhausted week is still returned, with
 * `awardXp: 0`. It is finished — the user did the work — and recording it as
 * such is what stops it being re-evaluated forever. The ceiling caps the
 * payout, not the achievement.
 */
export function settleChallenges(
  challenges: readonly AssignedChallenge[],
  context: ChallengeContext,
  awardedThisWeek: number
): ChallengeSettlement[] {
  let spent = awardedThisWeek;
  const settled: ChallengeSettlement[] = [];

  /*
   * Sorted, because the ceiling makes order observable: with 40 XP left and two
   * finished challenges worth 30, whichever is settled first is paid in full.
   * Two runs over the same data must reach the same answer, so the order cannot
   * be whatever the database happened to return.
   */
  const ordered = [...challenges].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  for (const challenge of ordered) {
    if (!SETTLEABLE.has(challenge.status)) continue;

    const { met, progress, target } = evaluateChallenge(challenge.spec, context);
    if (!met) continue;

    const awardXp = applyCeiling(spent, challenge.spec.reward_xp);
    spent += awardXp;

    settled.push({
      id: challenge.id,
      slug: challenge.slug,
      progress,
      target,
      rewardXp: challenge.spec.reward_xp,
      awardXp,
    });
  }

  return settled;
}
