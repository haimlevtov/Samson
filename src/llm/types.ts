import type { z } from 'zod';

export type LlmStage =
  | 'normalizer'
  | 'planner'
  | 'critic'
  | 'persona'
  | 'diet'
  | 'challenge'
  /** The open chat — ADR 0015. The only stage whose input has no shape. */
  | 'chat'
  /** A coach's line in its own voice — ADR 0025. Audio out, not text. */
  | 'speech'
  | 'smoke';

export type LlmCallStatus =
  | 'ok'
  | 'schema_invalid'
  | 'http_error'
  | 'timeout'
  | 'budget_denied'
  /**
   * The model answered and the answer was rejected by the content checks in
   * src/llm/safety.ts — ADR 0005.
   *
   * WHY a status rather than a silently discarded response: tokens were spent,
   * so invariant #3 requires the row, and the adversarial taxonomy PLAN.md asks
   * for is then countable from the ledger rather than reconstructed from memory.
   */
  | 'safety_blocked';

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
  /**
   * Extended thinking. Defaults to OFF — ADR 0007's Correction.
   *
   * Reasoning tokens come out of `maxTokens`, so a model left to think freely
   * can spend the entire budget and return an empty answer with HTTP 200. If
   * you enable this, raise `maxTokens` in the same change.
   */
  reasoning?: boolean;
}

/**
 * One text-to-speech call — ADR 0025.
 *
 * WHY there is no `system`, `schema` or `maxTokens`: a speech model takes one
 * input and returns audio. There is no instruction channel to keep untrusted
 * text out of, no completion to validate, and no tokens to cap — the gateway
 * bounds the input's length instead, `SPEECH_MAX_INPUT_CHARS`.
 *
 * INVARIANT: the input is known text — ADR 0025 §4. It is built by
 *            src/speech/script.ts from a shared persona row, never from what
 *            the browser sent.
 */
export interface SpeechOptions {
  userId: string;
  /** The whole input, in the model's own format: director's notes, then the transcript. */
  input: string;
  /** One of the model's voices — `SPEECH_VOICES` in src/speech/script.ts. */
  voice: string;
  maxAttempts?: number;
  timeoutMs?: number;
}

export interface SpeechResult {
  audio: Uint8Array;
  /** As the response declared it, e.g. `audio/mpeg`. Always an `audio/` type. */
  contentType: string;
  attempts: number;
  ledger: LlmCallInsert[];
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
