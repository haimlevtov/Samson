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
import { callLLM, callSpeech } from './gateway';
import { SAFETY_PREAMBLE } from './safety';
import { STAGE_MODELS } from './models';
import { MissingApiKeyError, SPEECH_MAX_INPUT_CHARS, hasApiKey, readApiKey } from './config';
import { BudgetExceededError, LlmCallFailedError } from './types';
import type { GatewayDeps, LedgerClient, LlmCallInsert } from './types';

const planSchema = z.object({ summary: z.string(), sessions: z.number().int() });

/** What Postgres refuses in a `text` value: a NUL, or half of a surrogate pair. */
function unstorable(value: string): boolean {
  return Array.from(value).some((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code === 0 || (code >= 0xd800 && code <= 0xdfff);
  });
}

function fakeLedger(overrides: Partial<LedgerClient> = {}) {
  const rows: LlmCallInsert[] = [];
  const client: LedgerClient = {
    insertLlmCall: async (row) => {
      // Refuses what Postgres refuses, so a test that a row lands means it —
      // the NUL that review found would otherwise pass here and fail there.
      for (const [field, value] of Object.entries(row)) {
        if (typeof value === 'string' && unstorable(value)) {
          throw new Error(`llm_calls insert failed: ${field} is not storable text`);
        }
      }
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
    // Static prompt first so the cache prefix holds — PLAN.md phase 2, and the
    // safety preamble ahead of the stage's own text — ADR 0005 §3.
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toBe(SAFETY_PREAMBLE + baseOptions.system);
    expect(body.messages[0].content.startsWith(SAFETY_PREAMBLE)).toBe(true);
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

const speechOptions = {
  userId: '11111111-1111-1111-1111-111111111111',
  input: 'NOTES: calm and even.\nTRANSCRIPT: Turn up on the Tuesday.',
  voice: 'Algenib',
};

/** Two 16-bit samples of raw PCM, as the model sends them. */
const PCM = new Uint8Array([0x10, 0x00, 0xf0, 0xff]);

const audioResponse = (body: BodyInit = PCM, headers: Record<string, string> = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'audio/pcm', 'x-generation-id': 'gen-tts-1', ...headers },
  });

/** The four ASCII bytes at `at` — a WAV header's chunk tags. */
const tag = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

describe('callSpeech', () => {
  /*
   * ADR 0025. The same door as callLLM — key, budget, retries, a ledger row per
   * attempt — with none of the text machinery, because what comes back is
   * audio. Every case runs against a scripted fetch; nothing here can speak.
   */

  it('asks the speech endpoint for PCM, and returns it as a WAV file', async () => {
    const urls: string[] = [];
    const { deps, calls } = makeDeps(async (url) => {
      urls.push(url);
      return audioResponse();
    });

    const result = await callSpeech(speechOptions, deps);

    expect(urls).toEqual(['https://example.invalid/api/v1/audio/speech']);
    expect(JSON.parse(String(calls[0]!.body))).toEqual({
      model: STAGE_MODELS.speech[0],
      input: speechOptions.input,
      voice: 'Algenib',
      response_format: 'pcm',
    });
    expect((calls[0]!.headers as Record<string, string>).Authorization).toBe(
      'Bearer test-key-not-a-real-secret'
    );
    // FOUND ON THE FIRST LIVE CALL: the model refuses mp3 with a 400, and a
    // browser plays no raw PCM — so the samples come back behind a WAV header.
    expect(result.contentType).toBe('audio/wav');
    expect(tag(result.audio, 0)).toBe('RIFF');
    expect(tag(result.audio, 8)).toBe('WAVE');
    expect([...result.audio.subarray(44)]).toEqual([...PCM]);
    expect(new DataView(result.audio.buffer).getUint32(24, true)).toBe(24_000);
    expect(result.attempts).toBe(1);
  });

  it('sends the input as it is, with no safety preamble for the model to read aloud', async () => {
    // The preamble is conduct rules for a TEXT model. A speech model given it
    // would perform it, before the coach's line.
    const { deps, calls } = makeDeps(async () => audioResponse());
    await callSpeech(speechOptions, deps);

    const body = JSON.parse(String(calls[0]!.body));
    expect(body.input).toBe(speechOptions.input);
    expect(body.input).not.toContain(SAFETY_PREAMBLE.slice(0, 40));
  });

  it('sends one model and no fallback array, because a voice belongs to one model', async () => {
    // ADR 0025 §3: a fallback would speak in a voice nobody cast.
    expect(STAGE_MODELS.speech).toHaveLength(1);

    const { deps, calls } = makeDeps(async () => audioResponse());
    await callSpeech(speechOptions, deps);

    const body = JSON.parse(String(calls[0]!.body));
    expect(body.models).toBeUndefined();
    expect(body.model).toBe(STAGE_MODELS.speech[0]);
  });

  it('writes one speech row: the generation id, the model, and no cost it did not measure', async () => {
    const { deps, rows } = makeDeps(async () => audioResponse());
    await callSpeech(speechOptions, deps);

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.stage).toBe('speech');
    expect(row.status).toBe('ok');
    expect(row.attempt).toBe(1);
    expect(row.openrouter_id).toBe('gen-tts-1');
    expect(row.model_used).toBe(STAGE_MODELS.speech[0]);
    expect(row.models_requested).toEqual([STAGE_MODELS.speech[0]]);
    // INVARIANT: the ledger records only what was measured. The budget gate
    //            charges the assumption instead — src/db/ledger.ts.
    expect(row.cost_credits).toBeNull();
    expect(row.upstream_cost).toBeNull();
    expect(row.prompt_prefix_hash).toBeNull();
    expect(row.error).toBeNull();
  });

  it('retries a transient failure and records both attempts', async () => {
    let n = 0;
    const { deps, rows } = makeDeps(async () =>
      ++n === 1 ? new Response('upstream busy', { status: 503 }) : audioResponse()
    );

    const result = await callSpeech(speechOptions, deps);

    expect(result.attempts).toBe(2);
    expect(rows.map((r) => r.status)).toEqual(['http_error', 'ok']);
    expect(rows[0]!.error).toContain('HTTP 503');
  });

  it('does not retry a request the provider rejected', async () => {
    const { deps, rows } = makeDeps(async () => new Response('unknown voice', { status: 400 }));

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('http_error');
  });

  it('never hands on a 200 that carries an error instead of audio, and does not pay twice', async () => {
    // Some failures arrive inside a 200. Played as audio, that is a broken
    // clip; recorded as a success, it is spend the ledger calls a preview. One
    // row, `schema_invalid`, which the budget charges — so no retry.
    const { deps, rows } = makeDeps(
      async () =>
        new Response('{"error":{"message":"voice not found"}}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
    );

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    expect(rows.map((r) => r.status)).toEqual(['schema_invalid']);
    expect(rows[0]!.error).toContain('expected audio/pcm, got application/json');
    expect(rows[0]!.error).toContain('voice not found');
  });

  it('refuses audio in a format other than the PCM it asked for', async () => {
    // FOUND IN REVIEW: any audio/* was accepted, so a model ignoring
    // response_format could fill the cache with clips no browser plays — and
    // mp3 wrapped as if it were PCM would play as noise.
    const { deps, rows } = makeDeps(async () =>
      audioResponse(PCM, { 'content-type': 'audio/mpeg' })
    );

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({ status: 'schema_invalid', stage: 'speech' });
  });

  it('records a wrong-format audio body without its bytes, so the row — the charge — lands', async () => {
    // FOUND IN THE SECOND REVIEW: the body was read as text into `error`, and
    // a WAV header carries NUL bytes, which Postgres refuses — no row, no
    // charge, on exactly the path written to charge.
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41]);
    const { deps, rows } = makeDeps(async () =>
      audioResponse(wav, { 'content-type': 'audio/wav', 'content-length': '10' })
    );

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('schema_invalid');
    expect(rows[0]!.error).toBe('expected audio/pcm, got audio/wav, 10 bytes');
  });

  it('takes audio/L16 as PCM, at the rate it names', async () => {
    const { deps } = makeDeps(async () =>
      audioResponse(PCM, { 'content-type': 'audio/L16;rate=16000' })
    );

    const result = await callSpeech(speechOptions, deps);
    expect(result.contentType).toBe('audio/wav');
    expect(new DataView(result.audio.buffer).getUint32(24, true)).toBe(16_000);
  });

  it('records a timeout during the read after a 200 as a timeout, and does not retry it', async () => {
    // Charged TIMEOUT_ASSUMED_COST_USD, and a 200 may have been billed, so a
    // retry would pay twice. FOUND IN THE THIRD REVIEW: nothing pinned this.
    const slow = new ReadableStream({
      start(controller) {
        controller.error(Object.assign(new Error('timed out reading'), { name: 'TimeoutError' }));
      },
    });
    const { deps, rows } = makeDeps(
      async () => new Response(slow, { status: 200, headers: { 'content-type': 'audio/pcm' } })
    );

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    expect(rows.map((r) => r.status)).toEqual(['timeout']);
  });

  it('charges a 200 whose body fails mid-read, and does not retry it', async () => {
    // FOUND IN THE SECOND REVIEW: it fell into the transport catch as an
    // http_error — retried, and charged nothing — though a 200 may be billed.
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    const { deps, rows } = makeDeps(
      async () => new Response(broken, { status: 200, headers: { 'content-type': 'audio/pcm' } })
    );

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    expect(rows.map((r) => r.status)).toEqual(['schema_invalid']);
  });

  it('accepts audio/pcm with parameters on the content type', async () => {
    const { deps } = makeDeps(async () =>
      audioResponse(PCM, { 'content-type': 'audio/pcm; codec=pcm' })
    );

    await expect(callSpeech(speechOptions, deps)).resolves.toMatchObject({ attempts: 1 });
  });

  it('treats an audio response with no bytes as the wrong shape, not a silent clip', async () => {
    const { deps, rows } = makeDeps(async () => audioResponse(new Uint8Array()));

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    expect(rows.map((r) => r.status)).toEqual(['schema_invalid']);
  });

  it('treats a single byte as no samples — half of one 16-bit sample is not audio', async () => {
    const { deps, rows } = makeDeps(async () => audioResponse(new Uint8Array([7])));

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    expect(rows.map((r) => r.status)).toEqual(['schema_invalid']);
  });

  it('ignores LLM_MODELS, which swaps text models and would recast every coach', async () => {
    // ADR 0025 §3: the override is for eval runs of the text stages. A speech
    // call that honoured it would speak in a voice nobody cast.
    vi.stubEnv('LLM_MODELS', 'openai/gpt-4o,google/gemini-2.5-flash');
    try {
      const { deps, calls } = makeDeps(async () => audioResponse());
      await callSpeech(speechOptions, deps);
      expect(JSON.parse(String(calls[0]!.body)).model).toBe(STAGE_MODELS.speech[0]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('records a timeout as its own status, which the budget charges', async () => {
    const { deps, rows } = makeDeps(async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    });

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'timeout' && r.stage === 'speech')).toBe(true);
  });

  it('denies an over-budget call with a row, and never reaches the network', async () => {
    const ledger = fakeLedger({
      sumSpendSince: async () => 0.5,
      getWeeklyBudgetUsd: async () => 0.5,
    });
    const fetchSpy = vi.fn();
    const { deps, rows } = makeDeps(async () => {
      fetchSpy();
      return audioResponse();
    }, ledger);

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(BudgetExceededError);

    expect(fetchSpy).not.toHaveBeenCalled();
    // INVARIANT: a denied call is still a call and still writes a row — CLAUDE.md #3
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({ stage: 'speech', status: 'budget_denied' });
  });

  it('refuses an input over the ceiling before charging or sending anything', async () => {
    const budgetSpy = vi.fn(async () => 1);
    const fetchSpy = vi.fn();
    const { deps, rows } = makeDeps(
      async () => {
        fetchSpy();
        return audioResponse();
      },
      fakeLedger({ getWeeklyBudgetUsd: budgetSpy })
    );

    await expect(
      callSpeech({ ...speechOptions, input: 'x'.repeat(SPEECH_MAX_INPUT_CHARS + 1) }, deps)
    ).rejects.toBeInstanceOf(RangeError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(budgetSpy).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it('fails the call when the ledger write fails', async () => {
    const ledger = fakeLedger({
      insertLlmCall: async () => {
        throw new Error('llm_calls insert failed: connection refused');
      },
    });
    const { deps } = makeDeps(async () => audioResponse(), ledger);

    await expect(callSpeech(speechOptions, deps)).rejects.toThrow('llm_calls insert failed');
  });
});

describe('the ledger writer', () => {
  /*
   * Postgres refuses a NUL in `text`, and half a surrogate pair — which a
   * `.slice()` can leave at the cut. A refused insert is a call with no row:
   * CLAUDE.md #3. Cleaned at the one writer both entry points share, so these
   * run through each.
   */
  it('strips NUL from an error body before the row is written, on the text path too', async () => {
    const { deps, rows } = makeDeps(
      async () => new Response(`bad${String.fromCharCode(0)}input`, { status: 400 })
    );

    await expect(callLLM(baseOptions, deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    expect(rows[0]!.error).toBe('HTTP 400: badinput');
  });

  it('cleans the fields a provider fills from its JSON, not only the error', async () => {
    // FOUND IN THE THIRD REVIEW: `model_used` and `openrouter_id` come straight
    // from the envelope, and a NUL there refused the row of a paid call.
    const nul = String.fromCharCode(0);
    const { deps, rows } = makeDeps(
      async () =>
        new Response(
          okBody({ summary: 'ok', sessions: 3 }, { model: `gemini${nul}`, id: `gen${nul}1` }),
          { status: 200 }
        )
    );

    await callLLM(baseOptions, deps);
    expect(rows[0]!.model_used).toBe('gemini');
    expect(rows[0]!.openrouter_id).toBe('gen1');
  });

  it('caps an unbounded error message', async () => {
    const { deps, rows } = makeDeps(
      async () =>
        new Response(
          JSON.stringify({ id: 'gen-x', model: 'm', error: { message: 'e'.repeat(10_000) } }),
          { status: 200 }
        )
    );

    await expect(callLLM(baseOptions, deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    expect(rows[0]!.error!.length).toBe(2_000);
  });

  it('replaces the half of a surrogate pair the 500-character cut leaves', async () => {
    // The emoji straddles the cut: character 500 is its high half alone.
    const body = `${'x'.repeat(499)}😀 and more`;
    const { deps, rows } = makeDeps(async () => new Response(body, { status: 503 }));

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(LlmCallFailedError);
    expect(rows[0]!.error).toBe(`HTTP 503: ${'x'.repeat(499)}${String.fromCodePoint(0xfffd)}`);
  });
});

describe('the budget gate', () => {
  it('denies a NaN spend, which `>=` would have let through', async () => {
    // FOUND IN THE SECOND REVIEW: `numeric` accepts 'NaN', and every
    // comparison with NaN is false.
    const fetchSpy = vi.fn();
    const { deps, rows } = makeDeps(
      async () => {
        fetchSpy();
        return new Response('{}', { status: 200 });
      },
      fakeLedger({ sumSpendSince: async () => Number.NaN })
    );

    await expect(callLLM(baseOptions, deps)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rows[0]!.status).toBe('budget_denied');
  });

  it('denies a NaN budget the same way', async () => {
    const { deps } = makeDeps(
      async () => audioResponse(),
      fakeLedger({ getWeeklyBudgetUsd: async () => Number.NaN })
    );

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('denies the budget as PostgREST returns a NaN — the string "NaN" — with the budget refusal', async () => {
    // FOUND IN THE THIRD REVIEW: the gate denied it, then BudgetExceededError's
    // toFixed threw on the string, and the user got a generic failure.
    const { deps } = makeDeps(
      async () => audioResponse(),
      fakeLedger({ getWeeklyBudgetUsd: async () => 'NaN' as unknown as number })
    );

    await expect(callSpeech(speechOptions, deps)).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

describe('hasApiKey', () => {
  it('says whether a key is set, by the same test readApiKey applies', () => {
    expect(hasApiKey({})).toBe(false);
    expect(hasApiKey({ OPENROUTER_API_KEY: '   ' })).toBe(false);
    expect(hasApiKey({ OPENROUTER_API_KEY: 'sk-test' })).toBe(true);
  });
});
