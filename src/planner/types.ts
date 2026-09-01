/**
 * The planner's dependency boundary.
 *
 * WHY these interfaces exist rather than importing the gateway and a Supabase
 * client directly: the same reasoning as `LedgerClient` in phase 0. The loop is
 * the part of phase 2 whose behaviour must be provable — iteration control,
 * which rejections escalate, what gets recorded — and none of that should need
 * a network, a database or an API key to demonstrate.
 *
 * `tests/unit/planner-loop.test.ts` builds this whole object from literals.
 */
import type { CallOptions, LlmResult } from '../llm/types';
import type { Rejection, TrainingBlock } from './schema';

/**
 * `callLLM` with its gateway dependencies already bound.
 *
 * AI-NOTE: the loop must never call `callLLM` directly — that would put the
 *          gateway's I/O back inside the unit under test, and CLAUDE.md #2 is
 *          satisfied by the *binding*, which happens in `createPlannerDeps`.
 */
export type LlmCaller = <T>(options: CallOptions<T>) => Promise<LlmResult<T>>;

export type PlanRunStatus =
  'accepted' | 'rejected_rules' | 'rejected_critic' | 'exhausted' | 'failed';

export interface PlanRunInsert {
  user_id: string;
  status: PlanRunStatus;
  iterations: number;
  /** INVARIANT: present exactly when status is 'accepted' — the DB check enforces it too. */
  block: TrainingBlock | null;
  rejections: Rejection[];
  input_hash: string | null;
}

/**
 * The narrow slice of the database the planner touches.
 * `src/db/plans.ts` holds the only Postgres-backed implementation.
 */
export interface PlanRunStore {
  insertPlanRun(row: PlanRunInsert): Promise<void>;
}

export interface PlannerDeps {
  call: LlmCaller;
  plans: PlanRunStore;
}
