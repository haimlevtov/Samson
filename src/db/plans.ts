/**
 * The Supabase-backed PlanRunStore.
 *
 * WHY this is the only implementation that touches Postgres: the planner loop
 * depends on the `PlanRunStore` interface instead, so the unit suite proves the
 * evaluator-optimizer's behaviour with no database at all — the same discipline
 * `src/db/ledger.ts` applies to the token ledger.
 *
 * INVARIANT: RLS is on and the row carries user_id — CLAUDE.md #10. This writes
 *            through a request-scoped client, never the service role.
 */
import type { Db } from './client';
import type { PlanRunInsert, PlanRunStore } from '../planner/types';
import type { Json } from './types';

export function createSupabasePlanStore(db: Db): PlanRunStore {
  return {
    async insertPlanRun(row: PlanRunInsert): Promise<void> {
      const { error } = await db.from('plan_runs').insert({
        user_id: row.user_id,
        status: row.status,
        iterations: row.iterations,
        // The generated column type is Json. TrainingBlock and Rejection are
        // JSON-shaped by construction — every field is a string, number,
        // boolean, array or plain object — so this cast asserts what the Zod
        // schemas have already validated.
        block: (row.block ?? null) as unknown as Json,
        rejections: row.rejections as unknown as Json,
        input_hash: row.input_hash,
      });

      if (error) {
        // WHY thrown rather than logged: a run whose outcome went unrecorded is
        // a gap in exactly the measurement this table exists to produce. The
        // same reasoning as the ledger write in the gateway.
        throw new Error(`plan_runs insert failed: ${error.message}`);
      }
    },
  };
}

/**
 * Seconds a plan run is treated as still in flight — rework PR 8b.
 *
 * Slightly above `app/coach/page.tsx`'s `maxDuration`, so a run the platform is
 * still executing always counts as recent. Below that and a second press could
 * slip in while the first is mid-generation, which is the case this exists for.
 */
export const PLAN_RUN_COOLDOWN_SECONDS = 75;

/**
 * Whether this user started a plan run in the last `PLAN_RUN_COOLDOWN_SECONDS`.
 *
 * FOUND IN REVIEW of PR 8b, and it is the finding with money attached. The only
 * thing stopping a second press was `disabled={pending}` on the button, which is
 * client state — the server action is a plain endpoint. An authenticated user
 * (or a second tab, or an impatient double-click) could start N concurrent runs,
 * and `enforceBudget` reads spend and then allows, so all N read the same stale
 * trailing figure and all N pass. The chat stage made that worth 400 tokens a
 * press; the planner makes it 6,000, at roughly $0.05 a planner call — measured $0.047 after the candidate-limit cut — against a $0.50
 * weekly ceiling.
 *
 * WHY a recency read rather than a lock or a queue: CLAUDE.md puts queues out of
 * scope, and this is one RLS-scoped indexed read on a table the run is about to
 * write anyway. It does not make concurrency impossible — two requests inside
 * the same millisecond still race — it makes the cheap, repeatable version of
 * the attack stop working, which is the one a bored user performs by accident.
 *
 * INVARIANT: scoped by RLS to the caller's own rows. `plan_runs` has read-own
 *            and insert-own policies and no service role is involved.
 */
export async function startedPlanRunRecently(db: Db, seconds: number): Promise<boolean> {
  const since = new Date(Date.now() - seconds * 1000).toISOString();

  const { data, error } = await db.from('plan_runs').select('id').gte('created_at', since).limit(1);

  // Thrown, not swallowed into `false`: a read that failed says nothing about
  // whether a run is in flight, and guessing "no" is the guess that spends.
  if (error) throw new Error(`plan_runs recency check failed: ${error.message}`);

  return (data ?? []).length > 0;
}
