/**
 * The Supabase-backed LedgerClient.
 *
 * INVARIANT: every gateway call writes a row to llm_calls — CLAUDE.md #3
 * WHY: this is the only implementation that touches Postgres. The gateway
 *      depends on the LedgerClient interface instead, so the unit suite runs
 *      with no database at all.
 */
import type { Db } from './client';
import type { LedgerClient, LlmCallInsert } from '../llm/types';

export function createSupabaseLedger(db: Db): LedgerClient {
  return {
    async insertLlmCall(row: LlmCallInsert): Promise<void> {
      const { error } = await db.from('llm_calls').insert(row);
      if (error) {
        // WHY: thrown, not logged and swallowed. A silent ledger gap is exactly
        //      the failure this table exists to prevent.
        throw new Error(`llm_calls insert failed: ${error.message}`);
      }
    },

    async sumSpendSince(userId: string, since: Date): Promise<number> {
      const { data, error } = await db
        .from('llm_calls')
        .select('cost_credits')
        .eq('user_id', userId)
        .gte('created_at', since.toISOString());

      if (error) throw new Error(`llm_calls spend query failed: ${error.message}`);

      // INVARIANT: deterministic code computes every number — CLAUDE.md #1.
      return (data ?? []).reduce((total, row) => total + (row.cost_credits ?? 0), 0);
    },

    async getWeeklyBudgetUsd(userId: string): Promise<number | null> {
      const { data, error } = await db
        .from('users')
        .select('llm_weekly_budget_usd')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw new Error(`budget lookup failed: ${error.message}`);
      return data?.llm_weekly_budget_usd ?? null;
    },
  };
}
