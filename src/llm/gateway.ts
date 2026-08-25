/**
 * The single door to OpenRouter.
 *
 * INVARIANT: all LLM calls go through this file — CLAUDE.md #2
 * INVARIANT: every call writes a row to llm_calls, failures included — CLAUDE.md #3
 * INVARIANT: the model never computes a number the user sees — CLAUDE.md #1.
 *            This module moves tokens; arithmetic lives in the metrics engine.
 *
 * All I/O is injected through GatewayDeps so the unit suite runs with no
 * network, no database and no API key — the phase 0 acceptance criterion.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WEEKLY_BUDGET_USD,
  OPENROUTER_BASE_URL,
  RETRY_BASE_DELAY_MS,
  attributionHeaders,
  modelOverrideFromEnv,
  readApiKey,
  type Env,
} from './config';
import { modelsForStage } from './models';
import {
  buildRequestBody,
  normalizeUsage,
  openRouterResponseSchema,
  toStrictJsonSchema,
} from './openrouter';
import {
  BudgetExceededError,
  LlmCallFailedError,
  type CallOptions,
  type ChatMessage,
  type GatewayDeps,
  type LedgerClient,
  type LlmCallInsert,
  type LlmResult,
} from './types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Production dependencies. Tests build their own object instead. */
export function createGatewayDeps(db: LedgerClient, env: Env = process.env): GatewayDeps {
  return {
    db,
    fetch: globalThis.fetch,
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    apiKey: readApiKey(env),
    baseUrl: OPENROUTER_BASE_URL,
    headers: attributionHeaders(env),
  };
}

function hashPrefix(system: string): string {
  return createHash('sha256').update(system).digest('hex').slice(0, 32);
}

function isRetryableHttp(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function callLLM<T>(
  options: CallOptions<T>,
  deps: GatewayDeps
): Promise<LlmResult<T>> {
  const models = modelsForStage(options.stage, options.models ?? modelOverrideFromEnv());
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const promptPrefixHash = hashPrefix(options.system);
  const ledger: LlmCallInsert[] = [];

  const record = async (row: LlmCallInsert): Promise<void> => {
    ledger.push(row);
    // WHY: not swallowed. A dropped ledger row is data the token analysis can
    //      never recover, so the call fails loudly instead — CLAUDE.md #3.
    await deps.db.insertLlmCall(row);
  };

  const blankRow = (attempt: number): LlmCallInsert => ({
    user_id: options.userId,
    stage: options.stage,
    attempt,
    status: 'http_error',
    models_requested: [...models],
    model_used: null,
    openrouter_id: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    cached_tokens: null,
    cache_write_tokens: null,
    reasoning_tokens: null,
    cost_credits: null,
    upstream_cost: null,
    latency_ms: 0,
    prompt_prefix_hash: promptPrefixHash,
    error: null,
  });

  // ---- Budget gate ------------------------------------------------------
  // WHY: checked before the request, not after, because the failure mode being
  //      defended against is a retry loop burning a free tier overnight.
  const budget = (await deps.db.getWeeklyBudgetUsd(options.userId)) ?? DEFAULT_WEEKLY_BUDGET_USD;
  const spent = await deps.db.sumSpendSince(
    options.userId,
    new Date(deps.now().getTime() - WEEK_MS)
  );

  if (spent >= budget) {
    // INVARIANT: a denied call is still a call and still writes a row — CLAUDE.md #3
    const denied = blankRow(1);
    denied.status = 'budget_denied';
    denied.error = `spent ${spent} of ${budget} USD in the trailing 7 days`;
    await record(denied);
    throw new BudgetExceededError(spent, budget);
  }

  const jsonSchema = toStrictJsonSchema(z.toJSONSchema(options.schema) as Record<string, unknown>);
  const messages: ChatMessage[] = [...options.messages];
  let costCredits = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = deps.now().getTime();
    const row = blankRow(attempt);
    let parsed: T | undefined;
    let retryable = false;
    let correction: ChatMessage[] | null = null;

    try {
      const response = await deps.fetch(`${deps.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${deps.apiKey}`,
          'Content-Type': 'application/json',
          ...deps.headers,
        },
        body: JSON.stringify(
          buildRequestBody({
            models,
            system: options.system,
            messages,
            schemaName: options.schemaName,
            jsonSchema,
            maxTokens: options.maxTokens,
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          })
        ),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const bodyText = await response.text();

      if (!response.ok) {
        row.status = 'http_error';
        row.error = `HTTP ${response.status}: ${bodyText.slice(0, 500)}`;
        retryable = isRetryableHttp(response.status);
      } else {
        const envelope = openRouterResponseSchema.parse(JSON.parse(bodyText));
        const usage = normalizeUsage(envelope.usage);

        row.model_used = envelope.model ?? null;
        row.openrouter_id = envelope.id ?? null;
        row.prompt_tokens = usage.promptTokens;
        row.completion_tokens = usage.completionTokens;
        row.total_tokens = usage.totalTokens;
        row.cached_tokens = usage.cachedTokens;
        row.cache_write_tokens = usage.cacheWriteTokens;
        row.reasoning_tokens = usage.reasoningTokens;
        row.cost_credits = usage.costCredits;
        row.upstream_cost = usage.upstreamCost;
        costCredits += usage.costCredits ?? 0;

        if (envelope.error) {
          // OpenRouter returns some failures inside a 200 envelope.
          row.status = 'http_error';
          row.error = envelope.error.message;
          retryable = true;
        } else {
          const content = envelope.choices?.[0]?.message?.content ?? '';
          const validation = safeParseJson(content, options.schema);

          if (validation.ok) {
            row.status = 'ok';
            parsed = validation.value;
          } else {
            row.status = 'schema_invalid';
            row.error = validation.error.slice(0, 1000);
            retryable = true;
            // WHY: re-prompting with the validation error attached turns a
            //      wasted retry into a targeted correction.
            correction = [
              { role: 'assistant', content: content.slice(0, 2000) },
              {
                role: 'user',
                content: `That response failed schema validation: ${validation.error}. Reply with JSON matching the schema exactly, and nothing else.`,
              },
            ];
          }
        }
      }
    } catch (cause) {
      const isTimeout = cause instanceof Error && cause.name === 'TimeoutError';
      row.status = isTimeout ? 'timeout' : 'http_error';
      row.error = cause instanceof Error ? cause.message : String(cause);
      retryable = true;
    } finally {
      row.latency_ms = Math.max(0, deps.now().getTime() - startedAt);
      await record(row);
    }

    if (parsed !== undefined) {
      return { data: parsed, modelUsed: row.model_used, attempts: attempt, costCredits, ledger };
    }

    if (!retryable || attempt === maxAttempts) break;
    if (correction) messages.push(...correction);
    await deps.sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
  }

  const last = ledger[ledger.length - 1];
  throw new LlmCallFailedError(
    `${options.stage} call failed after ${ledger.length} attempt(s): ${last?.status ?? 'unknown'} - ${last?.error ?? 'no detail'}`,
    ledger
  );
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function safeParseJson<T>(content: string, schema: z.ZodType<T>): ParseResult<T> {
  if (content.trim() === '') return { ok: false, error: 'empty completion' };

  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (cause) {
    return {
      ok: false,
      error: `not JSON: ${cause instanceof Error ? cause.message : 'parse error'}`,
    };
  }

  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: z.prettifyError(result.error) };
}
