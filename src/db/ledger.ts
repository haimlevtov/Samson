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

/** What `llm_spend_summary` returns for one user's window — migration 20260912090100. */
export interface SpendSummary {
  /** The sum of every measured `cost_credits`. The table refuses negative and NaN. */
  measured: number;
  /** Rows that timed out with no cost: billed upstream, never read — ADR 0007. */
  timeouts: number;
  /** Speech attempts that reached a 200 with no cost: the provider sends no price — ADR 0025. */
  unpricedSpeech: number;
}

/**
 * What a week's rows count against the budget: the measured spend, plus an
 * assumed price for each row that was billed but carries none.
 *
 * INVARIANT: deterministic code computes every number — CLAUDE.md #1.
 *
 * WHY the prices are applied here and not in SQL: they are estimates, and the
 * ledger records only what was measured — the token analysis is graded. The
 * database counts which rows need one; config says what each costs.
 *
 * WHY a sum that is not a finite number counts as unlimited: the table's CHECKs
 * refuse a NaN or negative cost since ADR 0026, but a gate that trusted them
 * would reopen if they were ever dropped. Denying is the safe failure.
 *
 * AI-NOTE: the categories are counted in `llm_spend_summary`. A new kind of
 *          unpriced row needs a count there and a price here, in one change.
 */
export function spendFrom(summary: SpendSummary): number {
  const total =
    summary.measured +
    summary.timeouts * TIMEOUT_ASSUMED_COST_USD +
    summary.unpricedSpeech * SPEECH_ASSUMED_COST_USD;
  return Number.isFinite(total) ? total : Number.POSITIVE_INFINITY;
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

    /*
     * Summed in Postgres, one round trip — ADR 0026 §2. FOUND IN REVIEW of #49:
     * this fetched every row and summed them here, and PostgREST stops at 1,000
     * rows, so a thousand planted zero-cost rows pushed real spend out of the
     * sum — the cap migration 20260902100200 had already fixed for XP.
     */
    async sumSpendSince(userId: string, since: Date): Promise<number> {
      const { data, error } = await db.rpc('llm_spend_summary', {
        p_user_id: userId,
        p_since: since.toISOString(),
      });

      if (error) throw new Error(`llm_calls spend query failed: ${error.message}`);

      const row = data?.[0];
      // Number(): `numeric` arrives as a number or a numeric string, `bigint`
      // counts as numbers; either way the arithmetic below wants numbers.
      return spendFrom({
        measured: Number(row?.measured ?? 0),
        timeouts: Number(row?.timeouts ?? 0),
        unpricedSpeech: Number(row?.unpriced_speech ?? 0),
      });
    },

    async getWeeklyBudgetUsd(userId: string): Promise<number | null> {
      const { data, error } = await db
        .from('users')
        .select('llm_weekly_budget_usd')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw new Error(`budget lookup failed: ${error.message}`);
      // Number(): `numeric` can arrive as a string. The CHECK refuses NaN since
      // ADR 0026, and the gate denies one either way.
      const budget = data?.llm_weekly_budget_usd;
      return budget === null || budget === undefined ? null : Number(budget);
    },
  };
}
