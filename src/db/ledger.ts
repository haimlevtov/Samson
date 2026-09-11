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
import type { LedgerClient, LlmCallInsert, LlmCallStatus, LlmStage } from '../llm/types';

/** Typed, so a misspelt stage fails to compile instead of charging nothing. */
const SPEECH: LlmStage = 'speech';

/**
 * Speech rows that reached a 200: `ok`, and `schema_invalid` for a 200 with no
 * usable mp3 — the wrong type, no bytes, or a body that failed mid-read. Either
 * may have been billed, so both are charged. (A timeout during that read keeps
 * its own status and is charged `TIMEOUT_ASSUMED_COST_USD`.)
 */
const SPOKEN: ReadonlySet<LlmCallStatus> = new Set<LlmCallStatus>(['ok', 'schema_invalid']);

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
 * WHY a failed speech row (`http_error`) is charged nothing: like any failed
 * call, no 200 came back, so nothing was generated to be billed for.
 *
 * WHY a negative cost counts as zero: `llm_calls_insert_own` lets a user insert
 * their own rows, and nothing in the table stops a negative `cost_credits` —
 * one such row would otherwise cancel a week of spend. FOUND IN REVIEW of #49;
 * the table-side check is the budget-integrity follow-up, and this gate does
 * not wait for it.
 *
 * WHY a cost that is not a finite number counts as unlimited: `numeric`
 * accepts 'NaN', PostgREST returns it as the string "NaN", and a NaN in the
 * sum made every comparison false — the gate never denied that account again.
 * Only a planted row can hold one, and this blocks only the account that
 * planted it. FOUND IN THE SECOND REVIEW of #49.
 */
export function chargedFor(row: {
  cost_credits: number | null;
  status: string;
  stage: string;
}): number {
  if (row.cost_credits !== null) {
    const cost = Number(row.cost_credits);
    return Number.isFinite(cost) ? Math.max(0, cost) : Number.POSITIVE_INFINITY;
  }
  if (row.status === 'timeout') return TIMEOUT_ASSUMED_COST_USD;
  if (row.stage === SPEECH && SPOKEN.has(row.status as LlmCallStatus)) {
    return SPEECH_ASSUMED_COST_USD;
  }
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
      // Number(): `numeric` 'NaN' comes back as the string "NaN". The gate
      // denies it either way; this keeps the declared type honest.
      const budget = data?.llm_weekly_budget_usd;
      return budget === null || budget === undefined ? null : Number(budget);
    },
  };
}
