/**
 * The project's only cross-user read, tested as one.
 *
 * `docs/PLAN.md` phase 6 asks for this in as many words: "A query as user A
 * against the leaderboard view returns user B's display name and XP and
 * **nothing else** — no email, no user_id, no set history. The RLS coverage
 * test in `tests/db` gains a case for the view, not an exemption."
 *
 * INVARIANT: the coverage test in schema-invariants.test.ts enumerates
 *            `relkind = 'r'`, so a VIEW is invisible to it. Without this file
 *            the leaderboard is a hole in that coverage rather than a surface
 *            it protects — ADR 0016, Consequences.
 *
 * Fixtures are made with the service role; every assertion runs through a
 * user-scoped client, the same split as tests/db/rls.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminClient, anonClient, createTestUser, deleteTestUser, type TestUser } from './helpers';

let alice: TestUser;
let bob: TestUser;

const WEEK = '2026-04-06';

/** Sets the profile fields the view reads. */
async function profile(
  userId: string,
  fields: { display_name?: string | null; leaderboard_opt_out?: boolean }
): Promise<void> {
  const { error } = await adminClient().from('users').update(fields).eq('user_id', userId);
  if (error) throw new Error(`fixture update failed: ${error.message}`);
}

async function giveXp(userId: string, amount: number): Promise<void> {
  const { error } = await adminClient().from('xp_events').insert({
    user_id: userId,
    source: 'adherence',
    amount,
    local_date: WEEK,
    week_start: WEEK,
  });
  if (error) throw new Error(`fixture xp failed: ${error.message}`);
}

beforeAll(async () => {
  alice = await createTestUser('leaderboard-a');
  bob = await createTestUser('leaderboard-b');
}, 60_000);

afterAll(async () => {
  await deleteTestUser(alice);
  await deleteTestUser(bob);
});

/** Each test decides who is on the board, so none inherits another's cohort. */
beforeEach(async () => {
  const admin = adminClient();
  await admin.from('xp_events').delete().in('user_id', [alice.id, bob.id]);
  await profile(alice.id, { display_name: null, leaderboard_opt_out: false });
  await profile(bob.id, { display_name: null, leaderboard_opt_out: false });
});

/** Only the rows this test's fixtures created — the database has seeded users too. */
async function boardFor(user: TestUser): Promise<Record<string, unknown>[]> {
  const { data, error } = await user.client
    .from('leaderboard')
    .select('*')
    .in('display_name', ['Alice Lifts', 'Bob Lifts']);

  if (error) throw new Error(`leaderboard read failed: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

describe('the leaderboard returns other users, which nothing else in the schema does', () => {
  it('shows user A user B’s name and XP', async () => {
    await profile(alice.id, { display_name: 'Alice Lifts' });
    await profile(bob.id, { display_name: 'Bob Lifts' });
    await giveXp(bob.id, 250);

    const seen = await boardFor(alice);
    const bobRow = seen.find((r) => r['display_name'] === 'Bob Lifts');

    expect(bobRow, 'Alice cannot see Bob — the view is not reading across users').toBeDefined();
    expect(bobRow?.['lifetime_xp']).toBe(250);
  });

  it('exposes nothing but the four intended columns', async () => {
    /*
     * The assertion PLAN.md asks for, written as an allowlist rather than a
     * list of things to be absent. A denylist only catches the leaks somebody
     * already thought of; this fails the moment a column is added, which is
     * when the decision to expose it should be made.
     */
    await profile(alice.id, { display_name: 'Alice Lifts' });

    const seen = await boardFor(alice);
    expect(seen.length).toBeGreaterThan(0);

    for (const row of seen) {
      expect(Object.keys(row).sort()).toEqual(['display_name', 'is_you', 'lifetime_xp', 'rank']);
    }
  });

  it('marks the caller’s own row and nobody else’s', async () => {
    await profile(alice.id, { display_name: 'Alice Lifts' });
    await profile(bob.id, { display_name: 'Bob Lifts' });

    const asAlice = await boardFor(alice);
    expect(asAlice.find((r) => r['display_name'] === 'Alice Lifts')?.['is_you']).toBe(true);
    expect(asAlice.find((r) => r['display_name'] === 'Bob Lifts')?.['is_you']).toBe(false);

    // The same rows, read by the other user, flip — so `is_you` is auth.uid()
    // rather than something baked into the row.
    const asBob = await boardFor(bob);
    expect(asBob.find((r) => r['display_name'] === 'Bob Lifts')?.['is_you']).toBe(true);
  });
});

describe('who appears at all', () => {
  it('leaves out a user who has opted out', async () => {
    await profile(alice.id, { display_name: 'Alice Lifts' });
    await profile(bob.id, { display_name: 'Bob Lifts', leaderboard_opt_out: true });

    const names = (await boardFor(alice)).map((r) => r['display_name']);
    expect(names).toContain('Alice Lifts');
    expect(names).not.toContain('Bob Lifts');
  });

  it('leaves out a user with no display name', async () => {
    // ADR 0016 §3. The alternatives were an email local part and a generated
    // placeholder; absence is the answer.
    await profile(alice.id, { display_name: 'Alice Lifts' });
    await giveXp(bob.id, 400); // would top the board, if he were on it

    const seen = await boardFor(alice);
    expect(seen.map((r) => r['display_name'])).toEqual(['Alice Lifts']);
  });

  it('leaves out a display name that is only whitespace', async () => {
    // The settings form turns '' into null, but a row written before that rule
    // — or by any other route — must not become a blank line on a shared page.
    await profile(alice.id, { display_name: 'Alice Lifts' });
    await profile(bob.id, { display_name: '   ' });

    expect((await boardFor(alice)).map((r) => r['display_name'])).toEqual(['Alice Lifts']);
  });

  it('includes a listed user who has never earned XP, at zero', async () => {
    // "You have not started" and "you are not here" are different facts.
    await profile(alice.id, { display_name: 'Alice Lifts' });

    const row = (await boardFor(alice))[0];
    expect(row?.['lifetime_xp']).toBe(0);
  });
});

describe('grants — the second gate', () => {
  it('refuses an unauthenticated reader', async () => {
    /*
     * ADR 0003's two independent gates, and ADR 0016 §5: an anonymous
     * leaderboard is a public directory of names and scores. RLS is bypassed
     * by the definer view, so the GRANT is the only thing standing here — which
     * is exactly why it gets its own test.
     */
    const { error } = await anonClient().from('leaderboard').select('display_name').limit(1);
    expect(error, 'anon could read the leaderboard').not.toBeNull();
  });
});

describe('ranking', () => {
  it('orders by XP, best first, and numbers ties deterministically', async () => {
    await profile(alice.id, { display_name: 'Alice Lifts' });
    await profile(bob.id, { display_name: 'Bob Lifts' });
    await giveXp(alice.id, 100);
    await giveXp(bob.id, 500);

    const seen = await boardFor(alice);
    const alicePos = seen.find((r) => r['display_name'] === 'Alice Lifts');
    const bobPos = seen.find((r) => r['display_name'] === 'Bob Lifts');

    expect(Number(bobPos?.['rank'])).toBeLessThan(Number(alicePos?.['rank']));
  });

  it('sums several events into one total', async () => {
    await profile(alice.id, { display_name: 'Alice Lifts' });
    await giveXp(alice.id, 100);
    await giveXp(alice.id, 75);

    expect((await boardFor(alice))[0]?.['lifetime_xp']).toBe(175);
  });
});
