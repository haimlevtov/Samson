/**
 * The only place in the codebase that reads the OpenRouter key.
 * INVARIANT: all LLM calls go through src/llm/gateway.ts — CLAUDE.md #2
 */

/** Anything env-shaped. Avoids forcing callers to fake all of NodeJS.ProcessEnv. */
export type Env = Record<string, string | undefined>;

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Fallback when a user row carries no explicit budget. */
export const DEFAULT_WEEKLY_BUDGET_USD = 0.5;

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Per-stage output ceilings.
 *
 * INVARIANT: max_tokens is always set — CLAUDE.md #2. These are the values the
 *            pipeline stages pass; there is no unbounded call path.
 *
 * WHY the planner ceiling is 6k and not 16k: it WAS 16k, and a four-week block
 * hit that exact number without finishing, in 158 seconds, returning truncated
 * JSON — ADR 0007. Set groups cut expected output to roughly 1,500–2,500
 * tokens, and 6k is generous headroom for a twelve-week block. A ceiling this
 * far above the expected size is a safety net, not a target: if a block ever
 * approaches it again, the shape is wrong, not the number.
 */
export const PLANNER_MAX_TOKENS = 6_000;
export const CRITIC_MAX_TOKENS = 1_500;

/**
 * The persona returns prose only — an opening, a note per week, a closing —
 * so it is small next to a block. Generous enough for a twelve-week plan.
 */
export const PERSONA_MAX_TOKENS = 2_000;

/** Free text into one exercise and its sets. Small by construction. */
export const NORMALIZER_MAX_TOKENS = 800;

/**
 * Planner→rules→critic passes before a run is abandoned.
 * WHY a hard cap rather than "until it passes": an unbounded revision loop is
 * the failure mode the budget gate exists to catch, and catching it there means
 * it has already been paid for.
 */
export const MAX_PLAN_ITERATIONS = 3;

/** Backoff for transport failures. Deliberately short — a demo cannot wait. */
export const RETRY_BASE_DELAY_MS = 500;

/**
 * The planner gets longer than the 60s default.
 *
 * WHY: measured generation runs near 100 output tokens per second, so a 2,500
 * token block is ~25s plus prompt processing — comfortably inside 60s, but with
 * little margin on a slow provider. Two minutes is slack, not permission to be
 * slow: the schema change in ADR 0007 is what made the call finish at all.
 */
export const PLANNER_TIMEOUT_MS = 120_000;

/**
 * Charged against the budget for a call that timed out.
 *
 * WHY this exists — ADR 0007: a timed-out call costs real money and writes
 * cost_credits null, because the gateway never reads a response and so has
 * nothing to record. Fourteen timeouts once reported $0.00005 to the ledger
 * while OpenRouter billed $0.5269. sumSpendSince reads cost_credits, so the
 * budget gate was blind to exactly the runaway it exists to stop.
 *
 * The ledger keeps recording only MEASURED cost — the token analysis is a
 * graded output and estimates in it would be corruption. This charge is applied
 * by the budget gate alone, and it is deliberately pessimistic.
 *
 * AI-NOTE: this is a guess in the safe direction. If a real figure ever becomes
 *          available for timed-out calls, delete the assumption rather than
 *          tuning it.
 */
export const TIMEOUT_ASSUMED_COST_USD = 0.05;

export class MissingApiKeyError extends Error {
  constructor() {
    // WHY: named error rather than a hang or a cryptic 401, because the phase 0
    //      acceptance criterion is that the suite passes with no key present —
    //      a test asserts this exact failure mode.
    super('OPENROUTER_API_KEY is not set. Copy .env.example to .env.local and fill it in.');
    this.name = 'MissingApiKeyError';
  }
}

export function readApiKey(env: Env = process.env): string {
  const key = env['OPENROUTER_API_KEY'];
  if (!key || key.trim() === '') throw new MissingApiKeyError();
  return key;
}

/** Optional attribution headers. Cosmetic; calls succeed without them. */
export function attributionHeaders(env: Env = process.env): Record<string, string> {
  const headers: Record<string, string> = {};
  const url = env['OPENROUTER_APP_URL'];
  const name = env['OPENROUTER_APP_NAME'];
  if (url) headers['HTTP-Referer'] = url;
  if (name) headers['X-Title'] = name;
  return headers;
}

export function modelOverrideFromEnv(env: Env = process.env): string[] | undefined {
  const raw = env['LLM_MODELS'];
  if (!raw) return undefined;
  const models = raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return models.length > 0 ? models : undefined;
}
