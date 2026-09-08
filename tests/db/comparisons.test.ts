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

let user: TestUser;

beforeAll(async () => {
  user = await createTestUser('cmp');
}, 60_000);

afterAll(async () => {
  await deleteTestUser(user);
});

async function ladder() {
  const { data, error } = await user.client
    .from('tonnage_comparisons')
    .select('slug, singular, plural, mass_kg, source_note')
    .order('mass_kg', { ascending: true });

  expect(error).toBeNull();
  return (data ?? []).map((row) => ({
    slug: row.slug,
    singular: row.singular,
    plural: row.plural,
    massKg: Number(row.mass_kg),
    sourceNote: row.source_note,
  }));
}

describe('who can see the ladder', () => {
  it('shows every shared row to a signed-in user', async () => {
    const rows = await ladder();
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it('shows a signed-out caller nothing', async () => {
    // INVARIANT: RLS and grants are two independent gates — ADR 0003. anon has
    // no policy on this table and no DML grant, and either one alone would be
    // enough; this measures that at least one of them is actually there.
    const { data, error } = await anonClient().from('tonnage_comparisons').select('slug');
    expect(data ?? []).toEqual([]);
    if (error === null) expect(data).toEqual([]);
  });

  it('refuses a user rewriting a shared row', async () => {
    // `tonnage_comparisons_write` is scoped to `user_id = auth.uid()`, and a
    // shared row has user_id null, so the USING clause is NULL rather than
    // true. A silent no-op is the correct outcome: PostgREST reports success
    // and updates nothing, because the row was never visible to the UPDATE.
    const before = await ladder();
    const target = before[0]!;

    await user.client
      .from('tonnage_comparisons')
      .update({ mass_kg: 999999 })
      .eq('slug', target.slug);

    const after = await ladder();
    expect(after[0]?.massKg).toBe(target.massKg);
  });
});

describe('the ladder is shaped for the sentence it produces', () => {
  it('gives every row a positive mass and a stated range', async () => {
    for (const row of await ladder()) {
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
