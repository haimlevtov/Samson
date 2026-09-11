/**
 * Tests for `spendFrom` in `src/db/ledger.ts` — what a week's ledger counts
 * against the budget, from the counts `llm_spend_summary` returns. Pure, so it
 * needs no database; which rows fall in which count is tested against Postgres
 * in tests/db/budget.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { spendFrom } from './ledger';
import { SPEECH_ASSUMED_COST_USD, TIMEOUT_ASSUMED_COST_USD } from '../llm/config';

const none = { measured: 0, timeouts: 0, unpricedSpeech: 0 };

describe('spendFrom', () => {
  it('charges measured spend as it was measured', () => {
    expect(spendFrom({ ...none, measured: 0.0042 })).toBe(0.0042);
  });

  it('charges each timed-out row the timeout assumption, since none was read — ADR 0007', () => {
    expect(spendFrom({ ...none, timeouts: 2 })).toBe(2 * TIMEOUT_ASSUMED_COST_USD);
  });

  it('charges each unpriced speech row the speech assumption, since the provider sends no price — ADR 0025', () => {
    expect(spendFrom({ ...none, unpricedSpeech: 3 })).toBe(3 * SPEECH_ASSUMED_COST_USD);
  });

  it('adds the three together', () => {
    expect(spendFrom({ measured: 0.1, timeouts: 1, unpricedSpeech: 1 })).toBeCloseTo(
      0.1 + TIMEOUT_ASSUMED_COST_USD + SPEECH_ASSUMED_COST_USD,
      10
    );
  });

  it('counts a sum that is not a finite number as unlimited, so the gate denies it', () => {
    // The table refuses NaN since ADR 0026; a gate that trusted that would
    // reopen the day the CHECK went.
    expect(spendFrom({ ...none, measured: Number.NaN })).toBe(Number.POSITIVE_INFINITY);
    expect(spendFrom({ ...none, measured: Number.POSITIVE_INFINITY })).toBe(
      Number.POSITIVE_INFINITY
    );
  });

  it('charges an empty week nothing', () => {
    expect(spendFrom(none)).toBe(0);
  });
});
