/**
 * Tests for the fixture helpers themselves.
 *
 * WHY these live in tests/db despite needing no database: they cover
 * `throughClockSkew`, which exists only for this suite, and the thing worth
 * proving about a retry is that it retries the RIGHT error. A retry that
 * swallows everything turns a broken fixture into a slow broken fixture, and
 * the suite stops meaning anything. Both branches are asserted here with fakes
 * rather than by waiting for a real clock disagreement, which by its nature
 * cannot be summoned on demand.
 */
import { describe, expect, it } from 'vitest';
import { throughClockSkew } from './helpers';

/** A caller that fails with `message` the first `failures` times, then succeeds. */
function flaky(failures: number, message: string) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    attempt: () => {
      calls += 1;
      return Promise.resolve({ error: calls <= failures ? { message } : null });
    },
  };
}

const SKEW = 'JWT issued at future';

describe('throughClockSkew', () => {
  it('returns without complaint when the first attempt works', async () => {
    const caller = flaky(0, SKEW);
    await expect(throughClockSkew(caller.attempt, 'fixture')).resolves.toBeUndefined();
    expect(caller.calls).toBe(1);
  });

  it('retries a token that is not yet valid, and succeeds', async () => {
    // Two rejections then success — the shape actually observed against hosted.
    const caller = flaky(2, SKEW);
    await expect(throughClockSkew(caller.attempt, 'fixture')).resolves.toBeUndefined();
    expect(caller.calls).toBe(3);
  });

  it('does not retry an error that is not a clock disagreement', async () => {
    const caller = flaky(1, 'duplicate key value violates unique constraint');

    await expect(throughClockSkew(caller.attempt, 'creating a profile')).rejects.toThrow(
      /creating a profile: duplicate key/
    );
    // The point of the test: one attempt, not five. A real failure fails fast.
    expect(caller.calls).toBe(1);
  });

  it('gives up rather than retrying forever, and says what failed', async () => {
    const caller = flaky(Number.MAX_SAFE_INTEGER, SKEW);

    await expect(throughClockSkew(caller.attempt, 'creating a profile')).rejects.toThrow(
      /creating a profile: JWT issued at future/
    );
    expect(caller.calls).toBe(5);
  });
});
