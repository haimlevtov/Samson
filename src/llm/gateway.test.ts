/**
 * Gateway unit suite.
 *
 * INVARIANT: tests pass with no API key present — CLAUDE.md conventions.
 * Every dependency is injected, so nothing here touches the network or a
 * database. If this file ever needs a secret, the gateway has grown a hidden
 * dependency and that is the bug.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { callLLM } from './gateway';
import { MissingApiKeyError, readApiKey } from './config';
import { BudgetExceededError, LlmCallFailedError } from './types';
import type { GatewayDeps, LedgerClient, LlmCallInsert } from './types';

const planSchema = z.object({ summary: z.string(), sessions: z.number().int() });

function fakeLedger(overrides: Partial<LedgerClient> = {}) {
  const rows: LlmCallInsert[] = [];
  const client: LedgerClient = {
    insertLlmCall: async (row) => {
      rows.push(row);
    },
    sumSpendSince: async () => 0,
    getWeeklyBudgetUsd: async () => 1,
    ...overrides,
  };
  return { rows, client };
}

function okBody(content: unknown, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'gen-abc123',
    model: 'google/gemini-2.5-flash-lite',
    choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
      cost: 0.000042,
      cost_details: { upstream_inference_cost: 0.000039 },
      prompt_tokens_details: { cached_tokens: 96, cache_write_tokens: 24 },
      completion_tokens_details: { reasoning_tokens: 5 },
    },
    ...extra,
  });
}

function makeDeps(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  ledger = fakeLedger()
): { deps: GatewayDeps; rows: LlmCallInsert[]; calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  let clock = 1_000;
  const deps: GatewayDeps = {
    db: ledger.client,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push(init);
      return fetchImpl(url, init);
    }) as unknown as typeof globalThis.fetch,
    now: () => new Date((clock += 25)),
    sleep: async () => {},
    apiKey: 'test-key-not-a-real-secret',
    baseUrl: 'https://example.invalid/api/v1',
    headers: {},
  };
  return { deps, rows: ledger.rows, calls };
}

const baseOptions = {
  userId: '11111111-1111-1111-1111-111111111111',
  stage: 'planner' as const,
  schema: planSchema,
  schemaName: 'training_plan',
  system: 'You are a planner. Static prefix.',
  messages: [{ role: 'user' as const, content: 'Plan my week.' }],
  maxTokens: 512,
};

describe('callLLM', () => {
  it('runs with no API key in the environment', () => {
    // The acceptance criterion is that the suite passes with no secrets, so the
    // absence of a key must be a named error rather than a hang or a 401.
    expect(() => readApiKey({})).toThrow(MissingApiKeyError);
    expect(() => readApiKey({ OPENROUTER_API_KEY: '  ' })).toThrow(MissingApiKeyError);
  });

  it('writes exactly one ledger row on success with every usage field mapped', async () => {
    const { deps, rows } = makeDeps(
      async () =>
        new Response(okBody({ summary: 'Upper/lower split', sessions: 4 }), { status: 200 })
    );

    const result = await callLLM(baseOptions, deps);

    expect(result.data).toEqual({ summary: 'Upper/lower split', sessions: 4 });
    expect(result.attempts).toBe(1);
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(row.status).toBe('ok');
    expect(row.model_used).toBe('google/gemini-2.5-flash-lite');
    expect(row.openrouter_id).toBe('gen-abc123');
    expect(row.prompt_tokens).toBe(120);
    expect(row.completion_tokens).toBe(30);
    expect(row.total_tokens).toBe(150);
    // Cache reads and cache writes are separate numbers and must stay separate.
    expect(row.cached_tokens).toBe(96);
    expect(row.cache_write_tokens).toBe(24);
    expect(row.reasoning_tokens).toBe(5);
    expect(row.cost_credits).toBe(0.000042);
    expect(row.upstream_cost).toBe(0.000039);
    expect(row.latency_ms).toBeGreaterThanOrEqual(0);
    expect(row.prompt_prefix_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(row.error).toBeNull();
  });

  it('always sends max_tokens, the fallback array, and a strict json schema', async () => {
    const { deps, calls } = makeDeps(
      async () => new Response(okBody({ summary: 'ok', sessions: 3 }), { status: 200 })
    );

    await callLLM(baseOptions, deps);

    const body = JSON.parse(String(calls[0]!.body));
    // INVARIANT: max_tokens is always set — CLAUDE.md #2
    expect(body.max_tokens).toBe(512);
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(1);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false);
    // Zod's $schema key is stripped: strict validators reject it.
    expect(body.response_format.json_schema.schema.$schema).toBeUndefined();
    expect(body.provider.require_parameters).toBe(true);
    // Static prompt first so the cache prefix holds — PLAN.md phase 2.
    expect(body.messages[0]).toEqual({ role: 'system', content: baseOptions.system });
  });

  it('retries a schema-invalid response and logs a row for the failed attempt', async () => {
    let call = 0;
    const { deps, rows, calls } = makeDeps(async () => {
      call += 1;
      return call === 1
        ? new Response(okBody({ summary: 'missing the sessions field' }), { status: 200 })
        : new Response(okBody({ summary: 'Push/pull/legs', sessions: 3 }), { status: 200 });
    });

    const result = await callLLM(baseOptions, deps);

    expect(result.attempts).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.status).toBe('schema_invalid');
    expect(rows[0]!.attempt).toBe(1);
    expect(rows[0]!.error).toContain('sessions');
    expect(rows[1]!.status).toBe('ok');
    expect(rows[1]!.attempt).toBe(2);

    // The retry carries the validation error so it is a correction, not a redo.
    const retryBody = JSON.parse(String(calls[1]!.body));
    const lastMessage = retryBody.messages.at(-1);
    expect(lastMessage.role).toBe('user');
    expect(lastMessage.content).toContain('failed schema validation');
  });

  it('accumulates cost across retried attempts', async () => {
    let call = 0;
    const { deps } = makeDeps(async () => {
      call += 1;
      return call === 1
        ? new Response(okBody({ nope: true }), { status: 200 })
        : new Response(okBody({ summary: 'fine', sessions: 2 }), { status: 200 });
    });

    const result = await callLLM(baseOptions, deps);
    expect(result.costCredits).toBeCloseTo(0.000084, 9);
  });

  it('retries a 500 and stops retrying a 400', async () => {
    let call = 0;
    const retryable = makeDeps(async () => {
      call += 1;
      return call === 1
        ? new Response('upstream exploded', { status: 500 })
        : new Response(okBody({ summary: 'recovered', sessions: 4 }), { status: 200 });
    });

    const recovered = await callLLM(baseOptions, retryable.deps);
    expect(recovered.attempts).toBe(2);
    expect(retryable.rows[0]!.status).toBe('http_error');

    const fatal = makeDeps(async () => new Response('bad request', { status: 400 }));
    await expect(callLLM(baseOptions, fatal.deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    // A 400 is not retried, but it is still logged.
    expect(fatal.rows).toHaveLength(1);
    expect(fatal.rows[0]!.status).toBe('http_error');
  });

  it('records a timeout as its own status', async () => {
    const { deps, rows } = makeDeps(async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    });

    await expect(callLLM({ ...baseOptions, maxAttempts: 2 }, deps)).rejects.toBeInstanceOf(
      LlmCallFailedError
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'timeout')).toBe(true);
  });

  it('treats an error envelope returned with HTTP 200 as a failure', async () => {
    const { deps, rows } = makeDeps(
      async () =>
        new Response(JSON.stringify({ error: { message: 'No allowed provider', code: 502 } }), {
          status: 200,
        })
    );

    await expect(callLLM({ ...baseOptions, maxAttempts: 1 }, deps)).rejects.toBeInstanceOf(
      LlmCallFailedError
    );
    expect(rows[0]!.status).toBe('http_error');
    expect(rows[0]!.error).toContain('No allowed provider');
  });

  it('logs one row for every attempt, failures included', async () => {
    const { deps, rows } = makeDeps(async () => new Response('nope', { status: 503 }));

    await expect(callLLM({ ...baseOptions, maxAttempts: 3 }, deps)).rejects.toBeInstanceOf(
      LlmCallFailedError
    );
    // INVARIANT: every gateway call writes a row, including retries — CLAUDE.md #3
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.attempt)).toEqual([1, 2, 3]);
  });

  it('denies an over-budget call, logs it, and never reaches the network', async () => {
    const ledger = fakeLedger({
      sumSpendSince: async () => 0.75,
      getWeeklyBudgetUsd: async () => 0.5,
    });
    const fetchSpy = vi.fn();
    const { deps, rows } = makeDeps(async () => {
      fetchSpy();
      return new Response('{}', { status: 200 });
    }, ledger);

    await expect(callLLM(baseOptions, deps)).rejects.toBeInstanceOf(BudgetExceededError);

    expect(fetchSpy).not.toHaveBeenCalled();
    // INVARIANT: a denied call is still a call and still writes a row — CLAUDE.md #3
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('budget_denied');
    expect(rows[0]!.error).toContain('0.75');
  });

  it('falls back to the default budget when the user row has none', async () => {
    const ledger = fakeLedger({
      sumSpendSince: async () => 0.49,
      getWeeklyBudgetUsd: async () => null,
    });
    const { deps } = makeDeps(
      async () => new Response(okBody({ summary: 'ok', sessions: 3 }), { status: 200 }),
      ledger
    );

    await expect(callLLM(baseOptions, deps)).resolves.toMatchObject({ attempts: 1 });
  });

  it('fails the call when the ledger write fails', async () => {
    // WHY: a call that succeeds upstream but leaves no row is unrecoverable data
    //      loss. Better to fail visibly than to under-report spend.
    const ledger = fakeLedger({
      insertLlmCall: async () => {
        throw new Error('llm_calls insert failed: connection refused');
      },
    });
    const { deps } = makeDeps(
      async () => new Response(okBody({ summary: 'ok', sessions: 3 }), { status: 200 }),
      ledger
    );

    await expect(callLLM(baseOptions, deps)).rejects.toThrow('llm_calls insert failed');
  });

  it('hashes the static prefix stably, and differently for a different prefix', async () => {
    const run = async (system: string) => {
      const { deps, rows } = makeDeps(
        async () => new Response(okBody({ summary: 'ok', sessions: 3 }), { status: 200 })
      );
      await callLLM({ ...baseOptions, system }, deps);
      return rows[0]!.prompt_prefix_hash;
    };

    const [a, b, c] = await Promise.all([run('prefix one'), run('prefix one'), run('prefix two')]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
