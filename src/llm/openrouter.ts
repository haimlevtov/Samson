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
}

export function buildRequestBody(input: RequestBodyInput): Record<string, unknown> {
  return {
    // `models` is the fallback array; OpenRouter falls through on error only.
    // `model` is not required when `models` is present.
    models: [...input.models],
    messages: [
      // Static first, dynamic last, so the cache prefix holds — PLAN.md phase 2.
      { role: 'system', content: input.system },
      ...input.messages,
    ],
    // INVARIANT: max_tokens is always set — CLAUDE.md #2
    max_tokens: input.maxTokens,
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    response_format: {
      type: 'json_schema',
      json_schema: { name: input.schemaName, strict: true, schema: input.jsonSchema },
    },
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
 * Zod emits a $schema key that strict structured-output validators reject.
 * AI-NOTE: strip it here rather than at call sites — every stage needs it gone.
 */
export function toStrictJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}
