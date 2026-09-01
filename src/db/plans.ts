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
