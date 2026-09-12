/**
 * The plan-request action's state shape — rework PR 8b, ADR 0027.
 *
 * WHY it is not in actions.ts: a `'use server'` module may export async
 * functions and nothing else. Exporting a plain object from one compiles and
 * type-checks cleanly, then fails at module evaluation with "can only export
 * async functions, found object" — the note ./coach-state.ts and ./state.ts
 * carry, which is where this project learned it.
 *
 * INVARIANT: every field here is either a code-owned string or a count. The
 *            BLOCK is not in it — an accepted plan is a `plan_runs` row, and the
 *            page re-reads it from the database rather than being handed one
 *            through client state. So there is no path by which a crafted POST
 *            renders a training block: the worst it can do is claim an outcome
 *            that did not happen, which is a lie about a number on a card rather
 *            than a plan somebody trains on.
 */

/**
 * What happened, as the card renders it.
 *
 * `idle` is before anything is pressed. The other five are the closed union
 * `PlanRunResult.status` already has, and ADR 0027 §4 requires each to say
 * something — a spinner that stops is not a state.
 */
export type PlanOutcome =
  | 'idle'
  | 'accepted'
  | 'rejected_rules'
  | 'rejected_critic'
  | 'exhausted'
  | 'failed'
  /** Refused before any call: no equipment rows, so no candidates — ADR 0027 §5. */
  | 'no-equipment'
  /** The form did not validate. Nothing was sent. */
  | 'invalid';

export interface PlanState {
  outcome: PlanOutcome;
  /**
   * How many findings the rules or the critic raised, when that is why it
   * stopped. A count rather than the findings themselves: the rejections are
   * already stored on the row, and the Hub renders them.
   */
  rejectionCount: number;
  /**
   * Why it failed, in the app's own words or the gateway's allowlisted ones.
   * Never a raw database or provider string — the same rule as every other
   * action on this page.
   */
  error: string | null;
}

export const EMPTY_PLAN_REQUEST: PlanState = {
  outcome: 'idle',
  rejectionCount: 0,
  error: null,
};
