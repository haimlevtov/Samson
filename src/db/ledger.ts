/**
 * The Supabase-backed LedgerClient.
 *
 * INVARIANT: every gateway call writes a row to llm_calls — CLAUDE.md #3
 * WHY: this is the only implementation that touches Postgres. The gateway
 *      depends on the LedgerClient interface instead, so the unit suite runs
 *      with no database at all.
 */
import { SPEECH_ASSUMED_COST_USD, TIMEOUT_ASSUMED_COST_USD } from '../llm/config';
import type { Db } from './client';
import type { LedgerClient, LlmCallInsert } from '../llm/types';

/**
 * What one ledger row counts against the weekly budget.
 *
 * INVARIANT: deterministic code computes every number — CLAUDE.md #1.
 *
 * WHY two kinds of row are charged an assumption rather than their
 * `cost_credits`: both are billed upstream and both record null. A call that
 * timed out never read a response — ADR 0007. A speech call reads audio, which
 * carries no price — ADR 0025. The ledger stays truthful and this gate stays
 * conservative; the estimates live here and never in a row.
 *
 * AI-NOTE: a speech row that failed (`http_error`) is charged nothing, like
 *          any failed call: no audio came back to be billed for.
 */
export function chargedFor(row: {
  cost_credits: number | null;
  status: string;
  stage: string;
}): number {
  if (row.cost_credits !== null) return row.cost_credits;
  if (row.status === 'timeout') return TIMEOUT_ASSUMED_COST_USD;
  if (row.stage === 'speech' && row.status === 'ok') return SPEECH_ASSUMED_COST_USD;
  return 0;
}

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
        .select('cost_credits, status, stage')
        .eq('user_id', userId)
        .gte('created_at', since.toISOString());

      if (error) throw new Error(`llm_calls spend query failed: ${error.message}`);

      return (data ?? []).reduce((total, row) => total + chargedFor(row), 0);
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
