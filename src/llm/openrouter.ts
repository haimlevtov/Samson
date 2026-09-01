/**
 * The wire format. This module and gateway.ts are the only code that knows what
 * OpenRouter's JSON looks like — CLAUDE.md #2.
 */
import { z } from 'zod';
import type { ChatMessage } from './types';

/**
 * AI-NOTE: usage accounting is automatic. The `usage: { include: true }` request
 *          parameter is deprecated and has no effect — full usage is returned on
 *          every response. Do not add a config flag for it.
 */
const usageSchema = z.object({
  prompt_tokens: z.number().optional(),
  completion_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  cost: z.number().optional(),
  cost_details: z.object({ upstream_inference_cost: z.number().nullish() }).loose().optional(),
  prompt_tokens_details: z
    .object({
      // Read from cache. Distinct from cache_write_tokens — never sum them.
      cached_tokens: z.number().nullish(),
      cache_write_tokens: z.number().nullish(),
    })
    .loose()
    .optional(),
  completion_tokens_details: z
    .object({ reasoning_tokens: z.number().nullish() })
    .loose()
    .optional(),
});

export const openRouterResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }).loose().optional(),
        // Read by the gateway: "length" means the answer was cut off, and
        // retrying an identical request truncates in the identical place.
        finish_reason: z.string().nullish(),
      })
    )
    .optional(),
  usage: usageSchema.optional(),
  // OpenRouter can return an error envelope with HTTP 200.
  error: z
    .object({ message: z.string(), code: z.union([z.number(), z.string()]).nullish() })
    .loose()
    .optional(),
});

export type OpenRouterResponse = z.infer<typeof openRouterResponseSchema>;

export interface NormalizedUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  costCredits: number | null;
  upstreamCost: number | null;
}

const nullable = (v: number | null | undefined): number | null => (v === undefined ? null : v);

export function normalizeUsage(usage: OpenRouterResponse['usage']): NormalizedUsage {
  return {
    promptTokens: nullable(usage?.prompt_tokens),
    completionTokens: nullable(usage?.completion_tokens),
    totalTokens: nullable(usage?.total_tokens),
    cachedTokens: nullable(usage?.prompt_tokens_details?.cached_tokens),
    cacheWriteTokens: nullable(usage?.prompt_tokens_details?.cache_write_tokens),
    reasoningTokens: nullable(usage?.completion_tokens_details?.reasoning_tokens),
    costCredits: nullable(usage?.cost),
    upstreamCost: nullable(usage?.cost_details?.upstream_inference_cost),
  };
}

export interface RequestBodyInput {
  models: readonly string[];
  system: string;
  messages: ChatMessage[];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  temperature?: number;
  /** Extended thinking. Off unless a stage asks — see buildRequestBody. */
  reasoning?: boolean;
}

export function buildRequestBody(input: RequestBodyInput): Record<string, unknown> {
  return {
    // `models` is the fallback array; OpenRouter falls through on error only.
    // `model` is not required when `models` is present.
    models: [...input.models],
    messages: [
      /*
       * Static first, dynamic last, so the cache prefix holds — PLAN.md phase 2.
       *
       * MEASURED, 2026-09-01: the cache hit rate over 484,340 prompt tokens was
       * 0.0%. The static-first layout had been in place since phase 0 and was
       * never actually caching anything, because Anthropic models bill caching
       * from explicit `cache_control` breakpoints rather than automatically.
       * The layout was right and the request was incomplete.
       *
       * AI-NOTE: the breakpoint goes on the LAST message that should be cached.
       *          Everything before it is cached together, so putting it on the
       *          system prompt caches exactly the part that never varies.
       */
      {
        role: 'system',
        content: input.system,
        cache_control: { type: 'ephemeral' },
      },
      ...input.messages,
    ],
    // INVARIANT: max_tokens is always set — CLAUDE.md #2
    max_tokens: input.maxTokens,
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    response_format: {
      type: 'json_schema',
      json_schema: { name: input.schemaName, strict: true, schema: input.jsonSchema },
    },
    /*
     * INVARIANT: extended thinking is OFF unless a stage explicitly asks.
     *
     * WHY, and it cost real money to learn — ADR 0007's Correction: reasoning
     * tokens are drawn from the SAME max_tokens budget as the answer. A
     * reasoning model given a hard problem will think until the budget is gone
     * and then return HTTP 200, finish_reason "length", and an EMPTY answer.
     * Every planner call did exactly that: 6000 completion tokens, 6000 of them
     * reasoning, zero content. Nothing about that response looks like a
     * misconfiguration — it looks like the model failing.
     *
     * AI-NOTE: if a stage ever turns this on, raise its max_tokens at the same
     *          time. Reasoning does not get its own budget.
     */
    reasoning: { enabled: input.reasoning ?? false },
    provider: {
      // WHY: without this, a request can route to an endpoint that ignores
      //      response_format and returns prose, which then fails Zod validation
      //      and burns a retry for no reason.
      require_parameters: true,
      allow_fallbacks: true,
    },
  };
}

/**
 * Prepares a Zod-generated JSON schema for the wire.
 *
 * Two things are removed:
 *
 * 1. The `$schema` key, which strict structured-output validators reject.
 * 2. Every scalar `minimum` / `maximum` / `exclusiveMinimum` /
 *    `exclusiveMaximum`.
 *
 * WHY the bounds go — MEASURED, 2026-09-01: `google/gemini-2.5-flash` refuses
 * the planner schema outright with "the specified schema produces a constraint
 * that has too many states for serving … integers or numbers with
 * minimum/maximum bounds". Every numeric bound multiplies the state space its
 * constrained decoder has to build, and ours are nested four deep.
 *
 * Nothing is weakened by removing them. The SAME Zod schema validates the
 * response when it comes back, so a value outside its range is still rejected —
 * it is rejected locally instead of upstream. What changes is that a cheaper
 * model becomes able to answer at all, and Sonnet builds a smaller decoder.
 *
 * AI-NOTE: array `minItems`/`maxItems` are deliberately KEPT. They bound the
 *          size of the response rather than the value of a scalar, which is a
 *          cost control, and they are what stops a model returning fifty weeks.
 */
export function toStrictJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return stripScalarBounds(rest) as Record<string, unknown>;
}

const SCALAR_BOUNDS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
]);

function stripScalarBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripScalarBounds);
  if (node === null || typeof node !== 'object') return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (SCALAR_BOUNDS.has(key)) continue;
    out[key] = stripScalarBounds(value);
  }
  return out;
}
