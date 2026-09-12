/**
 * ADR 0028's judgement, tested where it can be: pure, no key, no database.
 *
 * Every case here is a real finding from the six reviews the ADR tabulates, so
 * each one asserts something that actually leaked once.
 */
import { describe, expect, it } from 'vitest';
import { MissingApiKeyError } from './config';
import { BudgetExceededError, LlmCallFailedError, type LlmCallInsert } from './types';
import { LOG_MESSAGE_MAX_CHARS, isUserFacing, logLine, userFacingError } from './failure';

const FALLBACK = 'Could not read that. Try again in a moment.';

/** A gateway failure shaped like a real one, carrying its ledger rows. */
function gatewayFailure(upstream: string): LlmCallFailedError {
  const attempts: LlmCallInsert[] = [
    {
      user_id: 'a3f9c7e1-0000-4000-8000-000000000000',
      stage: 'normalizer',
      attempt: 1,
      status: 'http_error',
      models_requested: ['x/y'],
      latency_ms: 10,
      error: upstream,
    } as unknown as LlmCallInsert,
  ];
  // Two arguments, not four: the ledger rows are the SECOND parameter.
  return new LlmCallFailedError(
    `normalizer call failed after 1 attempt(s): 429 - ${upstream}`,
    attempts
  );
}

describe('isUserFacing', () => {
  it('admits the two classes ADR 0028 argues for', () => {
    expect(isUserFacing(new MissingApiKeyError())).toBe(true);
    expect(isUserFacing(new BudgetExceededError(0.62, 0.5))).toBe(true);
  });

  it('admits nothing else, including the class that carries the ledger', () => {
    expect(isUserFacing(gatewayFailure('quota exceeded for model x/y'))).toBe(false);
    expect(isUserFacing(new Error('relation "llm_calls" does not exist'))).toBe(false);
    expect(isUserFacing('a string')).toBe(false);
    expect(isUserFacing(null)).toBe(false);
    expect(isUserFacing(undefined)).toBe(false);
  });
});

describe('userFacingError', () => {
  it('shows the missing-key message, which says what to do', () => {
    const said = userFacingError(new MissingApiKeyError(), FALLBACK);
    expect(said).toContain('OPENROUTER_API_KEY');
    expect(said).not.toBe(FALLBACK);
  });

  it('shows the user their own spend against their own ceiling', () => {
    const said = userFacingError(new BudgetExceededError(0.62, 0.5), FALLBACK);
    expect(said).toContain('0.62');
    expect(said).toContain('0.50');
  });

  it('never leaks a Postgres message, not even a prefix of one', () => {
    /*
     * The `explain()` and `loadEvidence` findings. A raw error hands over table
     * names, column semantics and constraint names for tables the user cannot
     * read.
     */
    const pg = new Error(
      'new row for relation "llm_calls" violates check constraint "llm_calls_stage_check"'
    );
    const said = userFacingError(pg, FALLBACK);

    expect(said).toBe(FALLBACK);
    expect(said).not.toContain('llm_calls');
    expect(said).not.toContain('constraint');
    expect(said).not.toContain('relation');
  });

  it('never leaks the upstream body a gateway failure carries', () => {
    /*
     * The PR 8b finding. `LlmCallFailedError.message` is length-bounded and what
     * it is bounded TO is still the provider's words — including the request they
     * rejected. A length bound is not a content bound.
     */
    const said = userFacingError(gatewayFailure('quota exceeded for model x/y'), FALLBACK);

    expect(said).toBe(FALLBACK);
    expect(said).not.toContain('quota');
    expect(said).not.toContain('x/y');
    expect(said).not.toContain('429');
  });

  it('falls back for a thrown non-Error, which a crafted request can produce', () => {
    expect(userFacingError('boom', FALLBACK)).toBe(FALLBACK);
    expect(userFacingError({ message: 'boom' }, FALLBACK)).toBe(FALLBACK);
  });
});

describe('logLine', () => {
  it('carries the name, because the name is the diagnosis', () => {
    // The half a user-facing sentence necessarily discards.
    expect(logLine(gatewayFailure('quota exceeded'))).toMatch(/^LlmCallFailedError: /);
    expect(logLine(new MissingApiKeyError())).toMatch(/^MissingApiKeyError: /);
  });

  it('bounds the message, so an echoed request does not land in full', () => {
    const line = logLine(new Error('x'.repeat(5_000)));
    // The name and its separator, plus the bounded message.
    expect(line.length).toBeLessThanOrEqual('Error: '.length + LOG_MESSAGE_MAX_CHARS);
  });

  it('is a STRING, so no enumerable own property can be printed after a stack', () => {
    /*
     * THE FINDING THIS FUNCTION EXISTS FOR. `LlmCallFailedError` declares
     * `attempts: LlmCallInsert[]`, and Node prints an Error's own enumerable
     * properties after the stack — so `console.error(cause)` wrote the user's
     * auth UUID into the log once per attempt, plus the upstream body.
     *
     * Asserting the type is the assertion: a string cannot carry the array,
     * whatever a future editor does to the formatting.
     */
    const cause = gatewayFailure('echoed request body');
    const line = logLine(cause);

    expect(typeof line).toBe('string');
    expect(line).not.toContain('a3f9c7e1');
    expect(line).not.toContain('user_id');
    // And the ledger really is on the error, so this is not testing a stub.
    expect(cause.attempts[0]?.user_id).toBe('a3f9c7e1-0000-4000-8000-000000000000');
  });

  it('says "unknown" for a thrown non-Error rather than stringifying it', () => {
    expect(logLine({ secret: 'do not print me' })).toBe('unknown');
    expect(logLine('boom')).toBe('unknown');
  });
});
