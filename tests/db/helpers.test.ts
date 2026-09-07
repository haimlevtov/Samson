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
import { redactDbUrl, throughClockSkew } from './helpers';

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

/*
 * WHY these live beside throughClockSkew rather than in the unit suite: the
 * redactor exists only for this suite's failure path, and it runs exactly when
 * nobody is watching — inside an error thrown by a hook that already failed.
 *
 * The property under test is that it fails CLOSED. A substitution-based
 * redactor returns its input UNCHANGED when the pattern misses, and the inputs
 * that miss are precisely the malformed ones the caller's error branches exist
 * to explain. That is how a database owner password ends up in a terminal, an
 * agent transcript, and the issue somebody pastes it into.
 */
describe('redactDbUrl', () => {
  const PASSWORD = 'S3cr3tDbPassw0rd';

  /** Every case must satisfy this, whatever else it asserts. */
  function expectNoPassword(output: string): void {
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain(PASSWORD.slice(0, 8));
  }

  it('keeps the parts worth naming and drops the password', () => {
    const out = redactDbUrl(
      `postgresql://postgres.abcdef:${PASSWORD}@eu-central-1.pooler.supabase.com:6543/postgres`
    );

    expectNoPassword(out);
    // The user, host, port and database are the whole point of the message.
    expect(out).toBe(
      'postgresql://postgres.abcdef:***@eu-central-1.pooler.supabase.com:6543/postgres'
    );
  });

  it('redacts a string truncated mid-password by a wrapped paste', () => {
    // dotenv keeps only the first line, so the value can stop inside the
    // password with no @ to anchor on. The old regex printed this verbatim.
    expectNoPassword(redactDbUrl(`postgresql://postgres.abcdef:${PASSWORD}`));
  });

  it('redacts a string missing a slash in the scheme', () => {
    expectNoPassword(
      redactDbUrl(`postgresql:/postgres.abcdef:${PASSWORD}@eu-central-1.pooler.supabase.com:6543/x`)
    );
  });

  it('redacts a password containing an @', () => {
    // Legal once percent-encoded, and the character that breaks naive parsing.
    expectNoPassword(
      redactDbUrl(`postgresql://postgres.abcdef:p%40ss${PASSWORD}@host.example.com:6543/postgres`)
    );
  });

  it('redacts a password containing a colon', () => {
    expectNoPassword(
      redactDbUrl(`postgresql://postgres.abcdef:a%3Ab${PASSWORD}@host.example.com:6543/postgres`)
    );
  });

  it('says nothing at all when the value will not parse', () => {
    // Fail closed: an unrecognised shape is never echoed, because the only way
    // to be certain a password is absent from the output is to never copy it.
    for (const junk of ['', 'not a url', `${PASSWORD}@host`, `://x:${PASSWORD}@y`]) {
      const out = redactDbUrl(junk);
      expectNoPassword(out);
      expect(out).toBe('<SUPABASE_DB_URL — unparseable, not echoed>');
    }
  });

  it('handles the local default, which has no secret to lose', () => {
    expect(redactDbUrl('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).toBe(
      'postgresql://postgres:***@127.0.0.1:54322/postgres'
    );
  });
});
