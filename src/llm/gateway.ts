/**
 * The single door to OpenRouter.
 *
 * INVARIANT: all LLM calls go through this file — CLAUDE.md #2
 * INVARIANT: every call writes a row to llm_calls, failures included — CLAUDE.md #3.
 *            A call begins at the budget gate. Two refusals come before it and
 *            write no row, and nothing is sent or charged for either: an input
 *            over `callSpeech`'s ceiling, which the column limits make
 *            unreachable (ADR 0025's addendum), and a caller with no profile
 *            row, whose ledger row could not exist (ADR 0026 §3). And
 *            `openLedger` cleans every field the provider can fill before the
 *            insert, because a row Postgres refuses is a call with no row.
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
  OPENROUTER_BASE_URL,
  RETRY_BASE_DELAY_MS,
  SPEECH_MAX_ATTEMPTS,
  SPEECH_MAX_AUDIO_BYTES,
  SPEECH_MAX_INPUT_CHARS,
  SPEECH_MIN_AUDIO_SECONDS,
  SPEECH_TIMEOUT_MS,
  attributionHeaders,
  modelOverrideFromEnv,
  readApiKey,
  type Env,
} from './config';
import { SPEECH_MODEL, modelsForStage } from './models';
import { pcmBytesPerSecond, pcmRate, pcmToWav } from './wav';
import {
  buildRequestBody,
  normalizeUsage,
  openRouterResponseSchema,
  toStrictJsonSchema,
} from './openrouter';
import {
  SAFETY_PREAMBLE,
  SafetyBlockedError,
  fenceUntrusted,
  safetyCorrection,
  scanOutput,
  type SafetyFinding,
} from './safety';
import {
  BudgetExceededError,
  LlmCallFailedError,
  NoProfileError,
  type CallOptions,
  type ChatMessage,
  type GatewayDeps,
  type LedgerClient,
  type LlmCallInsert,
  type LlmResult,
  type SpeechOptions,
  type SpeechResult,
} from './types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A rejected completion, replayed for the model to correct.
 *
 * INVARIANT: fenced user content, never an `assistant` message — ADR 0015 §2.
 *
 * FOUND IN REVIEW, 2026-09-07. Both retry paths used to push
 * `{ role: 'assistant', content }` here, unfenced and unsanitised. That is the
 * model's own output, so it looks like the one thing that could safely occupy
 * the assistant role — but its CONTENT is shaped by whoever wrote the prompt,
 * and the assistant role is the channel a model treats as its own prior
 * reasoning.
 *
 * The concrete path: a message engineered to make the reply trip `scanOutput`
 * gets that reply echoed back pre-trusted on attempt two. It also laundered the
 * fence token itself into the payload outside any fence, because the echo was
 * never sanitised and the model can read the token out of SAFETY_PREAMBLE.
 *
 * WHY the correction beside it stays unfenced: ADR 0008. The instruction is
 * ours and belongs in the trusted region; the echoed attempt is data. Splitting
 * them is the whole point — a stage that fenced both would be telling the model
 * to fix a violation and to ignore the request in the same payload.
 */
function rejectedAttempt(content: string, maxChars: number): ChatMessage {
  return {
    role: 'user',
    content: fenceUntrusted('your previous attempt, which was rejected', content, maxChars),
  };
}

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

/**
 * What `response_format: 'pcm'` may come back labelled, compared lowercased:
 * `audio/pcm`, the provider's documented type, or `audio/l16`.
 *
 * WHY `audio/l16` is read as little-endian: RFC 2586 registers L16 as
 * big-endian, but Google labels this model's little-endian output
 * `audio/L16`, and `pcmToWav` writes the samples as they arrive. A provider
 * sending true big-endian L16 would play as noise — ADR 0025, "Corrected
 * after the first live calls".
 */
const PCM_TYPES: ReadonlySet<string> = new Set(['audio/pcm', 'audio/l16']);

/** A body worth quoting in the ledger — an error message, not bytes. */
function isTextual(mediaType: string): boolean {
  return mediaType.startsWith('text/') || mediaType.endsWith('json') || mediaType.endsWith('xml');
}

/** What stands in for half a surrogate pair: U+FFFD, the replacement character. */
const REPLACEMENT = String.fromCodePoint(0xfffd);

/**
 * The most of any one field a ledger row keeps. An upstream error message and
 * a thrown `cause.message` are otherwise unbounded, and the row is for reading.
 */
const LEDGER_TEXT_MAX = 2_000;

/**
 * Text Postgres will store, at most `LEDGER_TEXT_MAX` characters.
 *
 * WHY: Postgres refuses a NUL (U+0000) in `text` outright, and half of a
 * surrogate pair — which `.slice()` of a longer message can leave at the cut —
 * fails the insert too. A refused insert is a call with no row: unrecorded,
 * and uncharged against the budget. FOUND IN REVIEW of #49: a 200 carrying
 * audio in the wrong format was read as text into `error`, NULs and all.
 */
function storable(text: string): string {
  // By code point, so a whole pair stays whole and a half on its own is caught.
  return Array.from(text)
    .slice(0, LEDGER_TEXT_MAX)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 0) return '';
      return code >= 0xd800 && code <= 0xdfff ? REPLACEMENT : ch;
    })
    .join('');
}

const storableOrNull = (text: string | null): string | null =>
  text === null ? null : storable(text);

/**
 * The ledger for one call: every row it wrote, and the writer.
 *
 * WHY the insert is not swallowed: a dropped ledger row is data the token
 * analysis can never recover, so the call fails loudly instead — CLAUDE.md #3.
 * WHY the text is cleaned here rather than where each message is built: this
 * is the one writer both entry points share, so no path can miss it. Every
 * field the provider can fill is cleaned — `error`, and `model_used` and
 * `openrouter_id` from its JSON — not only the one review first found.
 */
function openLedger(deps: GatewayDeps): {
  ledger: LlmCallInsert[];
  record: (row: LlmCallInsert) => Promise<void>;
} {
  const ledger: LlmCallInsert[] = [];
  return {
    ledger,
    record: async (row) => {
      const clean: LlmCallInsert = {
        ...row,
        error: storableOrNull(row.error),
        model_used: storableOrNull(row.model_used),
        openrouter_id: storableOrNull(row.openrouter_id),
      };
      ledger.push(clean);
      await deps.db.insertLlmCall(clean);
    },
  };
}

/**
 * The weekly budget gate, the same for every entry point.
 *
 * WHY: checked before the request, not after, because the failure mode being
 *      defended against is a retry loop burning a free tier overnight.
 * INVARIANT: a denied call is still a call and still writes a row — CLAUDE.md #3
 */
async function enforceBudget(
  userId: string,
  deps: GatewayDeps,
  denied: LlmCallInsert,
  record: (row: LlmCallInsert) => Promise<void>
): Promise<void> {
  const configured = await deps.db.getWeeklyBudgetUsd(userId);
  /*
   * No profile row, no call — ADR 0026 §3. This refusal writes no row because
   * none can exist: `llm_calls.user_id` references `public.users`. It used to
   * fall back to a default here, send the paid request, and fail every ledger
   * insert after it. Like `callSpeech`'s input ceiling, it comes before the
   * gate, so nothing is sent or charged.
   */
  if (configured === null) throw new NoProfileError();

  // Number(): `LedgerClient` promises numbers and `src/db/ledger.ts` coerces
  // both, so this is the second of two. It stays because the interface is where
  // the promise is made and the gate is where breaking it costs money: a
  // `numeric` reaches PostgREST as a string — 'NaN' included — and a string here
  // would compare as a number below but throw in `BudgetExceededError`'s
  // `toFixed`, turning a refusal into a generic failure.
  const budget = Number(configured);
  const spent = Number(
    await deps.db.sumSpendSince(userId, new Date(deps.now().getTime() - WEEK_MS))
  );

  // WHY `!(spent < budget)` rather than `spent >= budget`: every comparison
  // with NaN is false, so the second form ALLOWS a NaN spend or budget — and a
  // `numeric` column accepts 'NaN'. This form denies it. FOUND IN REVIEW of #49.
  if (!(spent < budget)) {
    denied.status = 'budget_denied';
    denied.error = `spent ${spent} of ${budget} USD in the trailing 7 days`;
    await record(denied);
    throw new BudgetExceededError(spent, budget);
  }
}

export async function callLLM<T>(
  options: CallOptions<T>,
  deps: GatewayDeps
): Promise<LlmResult<T>> {
  const models = modelsForStage(options.stage, options.models ?? modelOverrideFromEnv());
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  /*
   * INVARIANT: every TEXT stage carries the conduct and injection preamble —
   *            ADR 0005 §3. Prepended here rather than at call sites so that a
   *            new text stage cannot omit it, and first in the string so it
   *            sits inside the cached prefix and costs almost nothing after the
   *            first call. The speech stage has none, because a speech model
   *            would read it aloud — ADR 0025's addendum, and `callSpeech`.
   */
  const system = SAFETY_PREAMBLE + options.system;
  // Hashed AFTER prepending: the hash identifies the prompt actually sent, so
  // editing the preamble correctly starts a new cache lineage in the ledger.
  const promptPrefixHash = hashPrefix(system);
  const { ledger, record } = openLedger(deps);

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

  await enforceBudget(options.userId, deps, blankRow(1), record);

  const jsonSchema = toStrictJsonSchema(z.toJSONSchema(options.schema) as Record<string, unknown>);
  const messages: ChatMessage[] = [...options.messages];
  // Kept across attempts so the terminal throw reports what was actually
  // caught, rather than a code invented at the throw site.
  let lastFindings: SafetyFinding[] = [];
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
            system,
            messages,
            schemaName: options.schemaName,
            jsonSchema,
            maxTokens: options.maxTokens,
            ...(options.reasoning === undefined ? {} : { reasoning: options.reasoning }),
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
          const truncated = envelope.choices?.[0]?.finish_reason === 'length';

          /*
           * Layer 4 runs BEFORE schema validation — ADR 0005 §4. A perfectly
           * well-formed response that insults the user is still one that must
           * not reach them, and shape says nothing about content.
           */
          const findings = scanOutput(content);

          if (findings.length > 0) {
            row.status = 'safety_blocked';
            row.error = findings
              .map((f) => `${f.code}: ${f.match}`)
              .join('; ')
              .slice(0, 1000);
            retryable = true;
            lastFindings = findings;
            // Corrected the same way a schema failure is: say what was wrong and
            // ask again, rather than spending a retry on the same question.
            correction = [
              rejectedAttempt(content, 500),
              { role: 'user', content: safetyCorrection(findings) },
            ];
          } else {
            const validation = safeParseJson(content, options.schema);

            if (validation.ok) {
              row.status = 'ok';
              parsed = validation.value;
            } else if (truncated) {
              /*
               * MEASURED, 2026-09-01: 13 planner calls hit max_tokens and
               * returned unparseable JSON, at $0.088 each — 45% of that run's
               * entire spend on nothing. Every retry truncated in the same
               * place, because nothing about the request had changed.
               *
               * So a length-truncated response is NOT retryable. The answer is
               * a smaller request or a larger ceiling, and both are decisions
               * for a human rather than another identical attempt.
               */
              row.status = 'schema_invalid';
              row.error = `response hit max_tokens (${options.maxTokens}) and was truncated; not retried — see the AI-NOTE in gateway.ts`;
              retryable = false;
            } else {
              row.status = 'schema_invalid';
              row.error = validation.error.slice(0, 1000);
              retryable = true;
              // WHY: re-prompting with the validation error attached turns a
              //      wasted retry into a targeted correction.
              correction = [
                rejectedAttempt(content, 2000),
                {
                  role: 'user',
                  content: `That response failed schema validation: ${validation.error}. Reply with JSON matching the schema exactly, and nothing else.`,
                },
              ];
            }
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

  /*
   * A run that died on content is a different fact from one that died on
   * transport, and the caller can act on the difference — src/planner/loop.ts
   * records it rather than filing it under "the model broke".
   */
  if (last?.status === 'safety_blocked') {
    throw new SafetyBlockedError(lastFindings);
  }

  throw new LlmCallFailedError(
    `${options.stage} call failed after ${ledger.length} attempt(s): ${last?.status ?? 'unknown'} - ${last?.error ?? 'no detail'}`,
    ledger
  );
}

/**
 * A coach's line in its own voice — ADR 0025. The same door as `callLLM`: the
 * key, the weekly budget gate, retries on transport failure, and an `llm_calls`
 * row for every attempt, failures included.
 *
 * WHY a second entry point rather than a mode of `callLLM`: little else is
 * shared. There is no system prompt, so no SAFETY_PREAMBLE — a speech model
 * would read it aloud. There is no schema to validate and no completion for
 * `scanOutput`, because what comes back is audio; instead a test holds every
 * shipped line to `scanOutput` (tests/db/personas.test.ts), and only shipped
 * lines are spoken. What IS shared is what CLAUDE.md #2 and #3 exist for:
 * one place that holds the key, the budget and the ledger. ADR 0025's addendum
 * records the exemption from ADR 0005 §3 and §4, and what stands in for it.
 *
 * INVARIANT: the input is known text — ADR 0025 §4. Callers build it with
 *            src/speech/script.ts from a shared persona row.
 */
export async function callSpeech(options: SpeechOptions, deps: GatewayDeps): Promise<SpeechResult> {
  if (options.input.length > SPEECH_MAX_INPUT_CHARS) {
    // A caller's bug, refused before the budget gate, so before anything is
    // sent or charged — see the INVARIANT at the top of this file. The column
    // limits make it unreachable: the longest script they allow is 1,104.
    throw new RangeError(
      `speech input is ${options.input.length} characters; the ceiling is ${SPEECH_MAX_INPUT_CHARS}`
    );
  }

  /*
   * WHY one model and no LLM_MODELS override: ADR 0025 §3 and its addendum. A
   * voice name belongs to one model, so a fallback would speak in a voice
   * nobody cast; and the override swaps TEXT models for an eval run, none of
   * which can speak. A retry goes back to the same model.
   */
  const model = SPEECH_MODEL;
  const maxAttempts = options.maxAttempts ?? SPEECH_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? SPEECH_TIMEOUT_MS;
  const { ledger, record } = openLedger(deps);

  const blankRow = (attempt: number): LlmCallInsert => ({
    user_id: options.userId,
    stage: 'speech',
    attempt,
    status: 'http_error',
    models_requested: [model],
    model_used: null,
    openrouter_id: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    cached_tokens: null,
    cache_write_tokens: null,
    reasoning_tokens: null,
    /*
     * INVARIANT: null, never an estimate. The response carries audio and a
     * generation id and no price, and the ledger records only what was
     * measured — the token analysis is graded. The budget gate charges
     * SPEECH_ASSUMED_COST_USD for these rows instead (src/db/ledger.ts), and
     * `openrouter_id` keeps what is needed to reconcile the real figure.
     */
    cost_credits: null,
    upstream_cost: null,
    latency_ms: 0,
    // No prompt prefix to cache: the input is one short string per coach.
    prompt_prefix_hash: null,
    error: null,
  });

  await enforceBudget(options.userId, deps, blankRow(1), record);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = deps.now().getTime();
    const row = blankRow(attempt);
    let spoken: Uint8Array<ArrayBuffer> | undefined;
    let retryable = false;
    // Set once a 200 arrives: from then on the attempt may have been billed.
    let reached200 = false;

    try {
      const response = await deps.fetch(`${deps.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${deps.apiKey}`,
          'Content-Type': 'application/json',
          ...deps.headers,
        },
        body: JSON.stringify({
          model,
          input: options.input,
          voice: options.voice,
          /*
           * The only format this model accepts. FOUND ON THE FIRST LIVE CALL:
           * `mp3` — which OpenRouter's page for the model lists — is refused
           * with HTTP 400, "Gemini TTS only supports response_format=pcm". No
           * browser plays raw PCM, so it is wrapped in a WAV header below —
           * ADR 0025, "Corrected after the first live calls".
           */
          response_format: 'pcm',
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      row.openrouter_id = response.headers.get('x-generation-id');
      const contentType = response.headers.get('content-type') ?? '';
      const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

      if (!response.ok) {
        row.status = 'http_error';
        row.error = `HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`;
        retryable = isRetryableHttp(response.status);
      } else if (!PCM_TYPES.has(mediaType)) {
        reached200 = true;
        /*
         * A 200 that is not the PCM asked for: an error body where the audio
         * should be, as chat completions sometimes send, or another format that
         * the wrapper below would turn into noise. FOUND IN REVIEW — this once
         * accepted any `audio/` type, so a model ignoring `response_format`
         * would have filled every coach's cache with an unplayable success.
         *
         * `schema_invalid`, the status for a 200 whose body is the wrong shape,
         * and NOT retried: the same request gets the same format, and a speech
         * row that reached a 200 may have been billed — src/db/ledger.ts
         * charges it the assumption, so a retry would be charged twice.
         *
         * Only a TEXT body is quoted. FOUND IN REVIEW: audio in another format
         * read as text carries NUL bytes, which Postgres refuses, so the row —
         * the charge — never landed.
         */
        row.status = 'schema_invalid';
        const size = response.headers.get('content-length');
        const got = `expected audio/pcm, got ${contentType || 'no content type'}`;
        if (isTextual(mediaType)) {
          row.error = `${got}: ${(await response.text()).slice(0, 500)}`;
        } else {
          await response.body?.cancel();
          row.error = size === null ? got : `${got}, ${size} bytes`;
        }
        retryable = false;
      } else {
        reached200 = true;
        /*
         * At least a quarter second of samples and at most a fixed byte
         * ceiling — the bounds and why are at SPEECH_MIN_AUDIO_SECONDS. Outside
         * them is the same as above: a 200, the wrong shape, charged, not
         * retried. A declared length past the ceiling is refused before the
         * body is read.
         */
        const rate = pcmRate(contentType);
        const minBytes = Math.ceil(SPEECH_MIN_AUDIO_SECONDS * pcmBytesPerSecond(rate));
        const maxBytes = SPEECH_MAX_AUDIO_BYTES;
        const declared = Number(response.headers.get('content-length') ?? Number.NaN);

        if (declared > maxBytes) {
          await response.body?.cancel();
          row.status = 'schema_invalid';
          row.error = `the clip declares ${declared} bytes; the most is ${maxBytes}`;
          retryable = false;
        } else {
          const pcm = new Uint8Array(await response.arrayBuffer());
          if (pcm.byteLength < minBytes || pcm.byteLength > maxBytes) {
            row.status = 'schema_invalid';
            row.error = `the clip is ${pcm.byteLength} bytes of PCM; it must be ${minBytes} to ${maxBytes}`;
            retryable = false;
          } else {
            // Wrapped first, so `ok` and `model_used` are set only once there
            // is a clip to hand on.
            const wav = pcmToWav(pcm, rate);
            row.status = 'ok';
            // Measured in the sense that matters: one model was requested and
            // no fallback array was sent, so the model that answered is this one.
            row.model_used = model;
            spoken = wav;
          }
        }
      }
    } catch (cause) {
      const isTimeout = cause instanceof Error && cause.name === 'TimeoutError';
      /*
       * After a 200 — the body failing mid-read — the generation may have been
       * billed, so the attempt is charged and not retried, like any other 200
       * that brought back no usable clip. FOUND IN REVIEW. A timeout keeps its
       * own status, which the gate already charges more for.
       */
      row.status = isTimeout ? 'timeout' : reached200 ? 'schema_invalid' : 'http_error';
      row.error = cause instanceof Error ? cause.message : String(cause);
      retryable = !reached200;
    } finally {
      row.latency_ms = Math.max(0, deps.now().getTime() - startedAt);
      await record(row);
    }

    // The type is what the gateway made, not the provider's header: the PCM it
    // received is inside a WAV file now.
    if (spoken !== undefined) {
      return { audio: spoken, contentType: 'audio/wav', attempts: attempt, ledger };
    }

    if (!retryable || attempt === maxAttempts) break;
    await deps.sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
  }

  const last = ledger[ledger.length - 1];
  throw new LlmCallFailedError(
    `speech call failed after ${ledger.length} attempt(s): ${last?.status ?? 'unknown'} - ${last?.error ?? 'no detail'}`,
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
