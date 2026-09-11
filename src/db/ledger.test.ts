/**
 * Tests for `chargedFor` in `src/db/ledger.ts` — what one ledger row counts
 * against the weekly budget. Pure, so it needs no database.
 */
import { describe, expect, it } from 'vitest';
import { chargedFor } from './ledger';
import { SPEECH_ASSUMED_COST_USD, TIMEOUT_ASSUMED_COST_USD } from '../llm/config';

const row = (over: Partial<Parameters<typeof chargedFor>[0]>) => ({
  cost_credits: null,
  status: 'ok',
  stage: 'chat',
  ...over,
});

describe('chargedFor', () => {
  it('charges a measured cost as it was measured, whatever the stage', () => {
    expect(chargedFor(row({ cost_credits: 0.0042 }))).toBe(0.0042);
    expect(chargedFor(row({ stage: 'speech', cost_credits: 0.003 }))).toBe(0.003);
  });

  it('charges a spoken attempt the assumption, since the provider reports no price', () => {
    // ADR 0025, Cost. Without this the gate counts every preview as free, and
    // a user could preview without limit on a budget that says otherwise.
    expect(chargedFor(row({ stage: 'speech', status: 'ok' }))).toBe(SPEECH_ASSUMED_COST_USD);
  });

  it('charges a timeout the timeout assumption, speech included', () => {
    // ADR 0007: billed upstream, never read. A speech timeout is no different.
    expect(chargedFor(row({ status: 'timeout' }))).toBe(TIMEOUT_ASSUMED_COST_USD);
    expect(chargedFor(row({ stage: 'speech', status: 'timeout' }))).toBe(TIMEOUT_ASSUMED_COST_USD);
  });

  it('charges a speech 200 that was the wrong shape, since it may have been billed', () => {
    // The gateway records it `schema_invalid` and does not retry it, so one
    // charge per press rather than none.
    expect(chargedFor(row({ stage: 'speech', status: 'schema_invalid' }))).toBe(
      SPEECH_ASSUMED_COST_USD
    );
  });

  it('counts a negative cost as nothing, so one planted row cannot cancel a week', () => {
    // FOUND IN REVIEW: `llm_calls_insert_own` lets a user insert their own
    // rows, and nothing in the table stops a negative cost.
    expect(chargedFor(row({ cost_credits: -9999 }))).toBe(0);
    expect(chargedFor(row({ stage: 'speech', cost_credits: -1 }))).toBe(0);
  });

  it('charges nothing for a failure that returned nothing, or a refusal', () => {
    expect(chargedFor(row({ stage: 'speech', status: 'http_error' }))).toBe(0);
    expect(chargedFor(row({ stage: 'speech', status: 'budget_denied' }))).toBe(0);
    expect(chargedFor(row({ status: 'http_error' }))).toBe(0);
  });

  it('leaves the speech assumption on speech rows only', () => {
    // A text response reports its own cost. One that arrived without it has
    // always been counted as nothing, and the speech charge must not widen to
    // every stage by accident.
    expect(chargedFor(row({ stage: 'chat', status: 'ok' }))).toBe(0);
  });
});
