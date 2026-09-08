/**
 * The tonnage comparison ladder, as content.
 *
 * The arithmetic is unit-tested in src/metrics/comparisons.test.ts and needs no
 * database. What needs one is everything that is a property of the ROWS: that
 * they are visible to a signed-in user and to nobody else, that nobody can
 * rewrite the shared ones, and that the ladder itself is shaped so the sentence
 * it produces stays readable.
 *
 * INVARIANT: the service role creates fixtures; every assertion runs through a
 *            user-scoped client — the same split as tests/db/rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, createTestUser, deleteTestUser, type TestUser } from './helpers';
import { compareTonnage } from '../../src/metrics/comparisons';
import { loadComparisonObjects } from '../../src/db/comparisons';

let user: TestUser;

beforeAll(async () => {
  user = await createTestUser('cmp');
}, 60_000);

afterAll(async () => {
  await deleteTestUser(user);
});

/**
 * The shipped reader, through a user-scoped client — the pattern
 * `leaderboard.test.ts` and `candidates.test.ts` use.
 *
 * FOUND IN REVIEW: this used to hand-roll the same select, the same ORDER BY
 * and the same row-to-camelCase map, which left the real reader's column list
 * and its `Number()` coercion asserted nowhere. A copy of the thing under test
 * measures the copy.
 */
const ladder = () => loadComparisonObjects(user.client);

describe('who can see the ladder', () => {
  it('shows every shared row to a signed-in user', async () => {
    const rows = await ladder();
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it('shows a signed-out caller nothing', async () => {
    // INVARIANT: RLS and grants are two independent gates — ADR 0003. anon has
    // no policy on this table and no DML grant, and either one alone would be
    // enough; this measures that at least one of them is actually there.
    const { data } = await anonClient().from('tonnage_comparisons').select('slug');
    expect(data ?? []).toEqual([]);
  });

  it('refuses a user rewriting a shared row', async () => {
    const before = await ladder();
    const target = before[0]!;

    const { error } = await user.client
      .from('tonnage_comparisons')
      .update({ mass_kg: 999999 })
      .eq('slug', target.slug);

    expect(error).not.toBeNull();

    const after = await ladder();
    expect(after[0]?.massKg).toBe(target.massKg);
  });

  it('refuses a user authoring a row of their own', async () => {
    /*
     * FOUND IN REVIEW: the table shipped with the catalogue policy PAIR,
     * because ADR 0002 says every catalogue table repeats it — and the write
     * half of that pair is justified in the ADR by a named future feature
     * (user-authored custom exercises). There is no such feature here, so the
     * pair granted INSERT to every authenticated session in exchange for
     * nothing, and PostgREST is a path whether or not the UI offers a button.
     *
     * Migration 20260908100100 dropped the policy and revoked the grant, which
     * is both gates. This asserts they are actually closed, and it is the test
     * that would fail if somebody restored the pair to make seeding easier.
     */
    const { error } = await user.client.from('tonnage_comparisons').insert({
      user_id: user.id,
      slug: `mine-${Date.now()}`,
      singular: 'a thing',
      plural: 'things',
      mass_kg: 1,
      source_note: 'invented',
    });

    expect(error).not.toBeNull();
  });

  it('refuses a user authoring a row that would be shared with everyone', async () => {
    // The escalation the write policy's WITH CHECK used to prevent, asserted
    // directly: a null user_id is what makes a row visible to every user in the
    // project, so it is the one insert that must never succeed.
    const { error } = await user.client.from('tonnage_comparisons').insert({
      user_id: null,
      slug: `shared-${Date.now()}`,
      singular: 'a thing',
      plural: 'things',
      mass_kg: 1,
      source_note: 'invented',
    });

    expect(error).not.toBeNull();
  });
});

describe('the ladder is shaped for the sentence it produces', () => {
  it('gives every row a usable mass and a stated range', async () => {
    for (const row of await ladder()) {
      // isFinite, not `> 0`. FOUND IN REVIEW: `check (mass_kg > 0)` admitted
      // NaN, because PostgreSQL orders NaN above every non-NaN numeric so it
      // can be indexed — `'NaN'::numeric > 0` is true. The constraint is now
      // `> 0 and < 1e10`; this asserts the property the constraint is for
      // rather than restating the constraint.
      expect(Number.isFinite(row.massKg), row.slug).toBe(true);
      expect(row.massKg, row.slug).toBeGreaterThan(0);
      expect(row.singular.length, row.slug).toBeGreaterThan(0);
      expect(row.plural.length, row.slug).toBeGreaterThan(0);
      // Not a citation — the migration says so at length — but a row with no
      // provenance at all is indistinguishable from a number somebody guessed.
      expect(row.sourceNote.length, row.slug).toBeGreaterThan(0);
    }
  });

  it('has no two rows of the same mass', async () => {
    // Two objects of equal mass make `compareTonnage`'s answer depend on the
    // order rows come back in, which is not something the reader promises.
    const masses = (await ladder()).map((row) => row.massKg);
    expect(masses).toHaveLength(new Set(masses).size);
  });

  it('never leaves a gap big enough to print an absurd count', async () => {
    /*
     * `compareTonnage` takes the heaviest object passed, so the largest count a
     * user can ever be shown at a given rung is the ratio to the NEXT rung up.
     * A ladder with a hundredfold step would tell somebody they had lifted
     * ninety-nine pianos, which is the failure the whole feature exists to
     * avoid — it is a bare number again, wearing a costume.
     */
    const rows = await ladder();
    for (let n = 1; n < rows.length; n += 1) {
      const step = rows[n]!.massKg / rows[n - 1]!.massKg;
      expect(step, `${rows[n - 1]!.slug} to ${rows[n]!.slug}`).toBeLessThanOrEqual(20);
    }
  });

  it('reaches past anything a user will actually lift', async () => {
    // The top of the ladder is aspirational on purpose. 3,000,000 kg is roughly
    // five years of serious training; if the heaviest row were under it, a
    // long-standing user would be handed a four-figure count forever.
    const rows = await ladder();
    expect(rows.at(-1)!.massKg).toBeGreaterThan(3_000_000);
  });

  it('agrees with the selector the app actually uses', async () => {
    // The unit tests run against literals. This runs the same function against
    // the shipped rows, which is the only place the two can be seen to match.
    const rows = await ladder();
    const lightest = rows[0]!;

    expect(compareTonnage(lightest.massKg - 0.01, rows)).toBeNull();
    expect(compareTonnage(lightest.massKg, rows)?.object.slug).toBe(lightest.slug);

    const heaviest = rows.at(-1)!;
    const top = compareTonnage(heaviest.massKg * 2, rows);
    expect(top?.object.slug).toBe(heaviest.slug);
    expect(top?.count).toBe(2);
  });
});
