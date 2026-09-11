/**
 * Tests for `src/speech/refusal.ts`.
 */
import { describe, expect, it } from 'vitest';
import { refusalFor } from './refusal';
import { MissingApiKeyError } from '../llm/config';
import { BudgetExceededError, LlmCallFailedError } from '../llm/types';

describe('refusalFor', () => {
  it('names a missing key, so the card says the voices are not set up', () => {
    expect(refusalFor(new MissingApiKeyError())).toBe('no-key');
  });

  it('names a spent budget, so the card does not invite a retry that cannot work', () => {
    expect(refusalFor(new BudgetExceededError(0.52, 0.5))).toBe('budget');
  });

  it('files everything else as a failure, the upstream detail included', () => {
    // The browser gets the reason code and nothing more; a provider's body, a
    // Postgres message and a thrown string all collapse to the same one.
    expect(refusalFor(new LlmCallFailedError('speech call failed: HTTP 500', []))).toBe('failed');
    expect(refusalFor(new Error('llm_calls insert failed'))).toBe('failed');
    expect(refusalFor('a string')).toBe('failed');
  });
});
