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

/** Backoff for transport failures. Deliberately short — a demo cannot wait. */
export const RETRY_BASE_DELAY_MS = 500;

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
