import type { z } from 'zod';

export type LlmStage =
  'normalizer' | 'planner' | 'critic' | 'persona' | 'diet' | 'challenge' | 'smoke';

export type LlmCallStatus = 'ok' | 'schema_invalid' | 'http_error' | 'timeout' | 'budget_denied';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * One row of public.llm_calls.
 * INVARIANT: every gateway call writes one of these, including failures — CLAUDE.md #3
 */
export interface LlmCallInsert {
  user_id: string;
  stage: LlmStage;
  attempt: number;
  status: LlmCallStatus;
  models_requested: string[];
  model_used: string | null;
  openrouter_id: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cached_tokens: number | null;
  cache_write_tokens: number | null;
  reasoning_tokens: number | null;
  cost_credits: number | null;
  upstream_cost: number | null;
  latency_ms: number;
  prompt_prefix_hash: string | null;
  error: string | null;
}

/**
 * The narrow slice of the database the gateway touches.
 *
 * WHY: the gateway depends on this interface rather than on SupabaseClient so
 *      unit tests run with no database, no network and no API key — the phase 0
 *      acceptance criterion. src/db/ledger.ts is the real implementation.
 */
export interface LedgerClient {
  insertLlmCall(row: LlmCallInsert): Promise<void>;
  /** Total cost_credits for this user since the given instant. */
  sumSpendSince(userId: string, since: Date): Promise<number>;
  /** users.llm_weekly_budget_usd, or null when the row is absent. */
  getWeeklyBudgetUsd(userId: string): Promise<number | null>;
}

export interface GatewayDeps {
  db: LedgerClient;
  fetch: typeof globalThis.fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
}

export interface CallOptions<T> {
  userId: string;
  stage: LlmStage;

  /** Validates the response and generates the JSON schema sent upstream. */
  schema: z.ZodType<T>;
  schemaName: string;

  /**
   * Static prompt content. Placed first and hashed into prompt_prefix_hash.
   * WHY: phase 2 needs the cache prefix to hold across calls, which only works
   *      if the invariant part of the prompt precedes anything user-specific.
   */
  system: string;

  /** Dynamic, per-call content. Untrusted user text belongs here, never in `system`. */
  messages: ChatMessage[];

  /** INVARIANT: always set — CLAUDE.md #2. There is no unbounded call path. */
  maxTokens: number;

  models?: readonly string[];
  temperature?: number;
  maxAttempts?: number;
  timeoutMs?: number;
}

export interface LlmResult<T> {
  data: T;
  modelUsed: string | null;
  attempts: number;
  costCredits: number;
  ledger: LlmCallInsert[];
}

export class BudgetExceededError extends Error {
  constructor(
    readonly spent: number,
    readonly budget: number
  ) {
    super(`Weekly LLM budget exhausted: spent ${spent.toFixed(4)} of ${budget.toFixed(4)} USD.`);
    this.name = 'BudgetExceededError';
  }
}

export class LlmCallFailedError extends Error {
  constructor(
    message: string,
    readonly attempts: LlmCallInsert[]
  ) {
    super(message);
    this.name = 'LlmCallFailedError';
  }
}
