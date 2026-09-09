/**
 * The supplement evidence table, as content.
 *
 * `src/evidence/doi.test.ts` covers the DOI format against literals, offline.
 * `npm run verify:doi` resolves each one against the registry, online. What
 * needs a database is the shape of the ROWS — that every claim carries a source,
 * that no grade is invented, and that nobody but the project can write one.
 *
 * ADR 0023 splits the acceptance criterion three ways and this is the middle
 * third: rows, no network.
 *
 * INVARIANT: the service role creates fixtures; every assertion runs through a
 *            user-scoped client — the same split as tests/db/rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, anonClient, createTestUser, deleteTestUser, type TestUser } from './helpers';
import { EVIDENCE_GRADES, loadEvidence } from '../../src/db/evidence';
import { isDoi } from '../../src/evidence/doi';

let user: TestUser;

beforeAll(async () => {
  user = await createTestUser('evidence');
}, 60_000);

afterAll(async () => {
  await deleteTestUser(user);
});

/** The shipped reader, through a user-scoped client. */
const table = () => loadEvidence(user.client);

describe('the shipped rows', () => {
  it('returns rows at all', async () => {
    const { rows } = await table();
    expect(rows.length, 'the migration seeds the rows; has it been applied?').toBeGreaterThan(0);
  });

  it('drops nothing on the way through validation', async () => {
    /*
     * `loadEvidence` silently discards a row that fails its schema, because
     * there is no safe way to render a health claim whose grade or citation did
     * not parse. That is the right behaviour and it makes a content error
     * invisible — so the count is asserted here, where it is visible.
     */
    const { dropped } = await table();
    expect(dropped, 'a shipped row failed validation and was hidden from the page').toBe(0);
  });

  it('gives every claim a well-formed DOI', async () => {
    // The acceptance criterion's offline half, applied to the actual rows
    // rather than to literals.
    const malformed = (await table()).rows.filter((row) => !isDoi(row.doi));
    expect(malformed.map((row) => `${row.slug}: ${row.doi}`)).toEqual([]);
  });

  it('cites a different source for every claim', async () => {
    /*
     * ADR 0023: "no row summarises a literature". Reusing one DOI across two
     * claims is that failure wearing a citation — the second claim would have
     * no source that was chosen to back IT.
     */
    const dois = (await table()).rows.map((row) => row.doi);
    expect(dois.length - new Set(dois).size, 'a DOI is cited by two rows').toBe(0);
  });

  it('uses only the grades the ADR defines', async () => {
    const rows = await table();
    for (const row of rows.rows) {
      expect(EVIDENCE_GRADES, `${row.slug} has grade ${row.grade}`).toContain(row.grade);
    }
  });

  it('ships rows that say the evidence does not support the claim', async () => {
    /*
     * The one assertion here that is about EDITORIAL content rather than shape,
     * and it is deliberate. ADR 0023: D rows "ship on purpose, and they are the
     * point" — a supplement table without them is the marketing it is supposed
     * to be an antidote to. If someone later prunes the table down to the
     * flattering rows, this is what says no.
     */
    const grades = (await table()).rows.map((row) => row.grade);
    expect(grades.filter((grade) => grade === 'D').length).toBeGreaterThanOrEqual(3);
  });

  it('names a source and a plausible year for every row', async () => {
    const currentYear = new Date().getUTCFullYear();
    for (const row of (await table()).rows) {
      expect(row.sourceTitle.length, `${row.slug} has no source title`).toBeGreaterThan(10);
      expect(row.sourceYear, `${row.slug} year`).toBeGreaterThanOrEqual(1990);
      expect(row.sourceYear, `${row.slug} year`).toBeLessThanOrEqual(currentYear + 1);
    }
  });

  it('shows a signed-out caller nothing', async () => {
    // INVARIANT: RLS and grants are two independent gates — ADR 0003.
    const { data } = await anonClient().from('supplement_evidence').select('slug');
    expect(data ?? []).toEqual([]);
  });
});

describe('a user cannot author a claim', () => {
  /*
   * The table ships with a read policy and NO write policy — migration
   * 20260909100000, following the lesson of 20260908120100, where
   * `progression_nodes` carried a write half for a feature that did not exist.
   *
   * It matters more here than it did there. `supplement_evidence_slug_unique` is
   * `unique nulls not distinct (user_id, slug)`, so a user row could reuse a
   * system slug — and these rows are health claims with citations attached. A
   * user-authored row rendering beside a position stand is the worst thing this
   * table could do.
   */
  it('refuses a claim of their own', async () => {
    const { error } = await user.client.from('supplement_evidence').insert({
      user_id: user.id,
      slug: `mine-${Date.now()}`,
      supplement: 'Something I sell',
      claim: 'Works wonders.',
      grade: 'A',
      doi: '10.1186/fake',
      source_title: 'A paper I did not read',
      source_year: 2024,
    });

    expect(error).not.toBeNull();
  });

  it('refuses a claim that would be shared with everyone', async () => {
    const { error } = await user.client.from('supplement_evidence').insert({
      user_id: null,
      slug: `shared-${Date.now()}`,
      supplement: 'Something I sell',
      claim: 'Works wonders.',
      grade: 'A',
      doi: '10.1186/fake',
      source_title: 'A paper I did not read',
      source_year: 2024,
    });

    expect(error).not.toBeNull();
  });

  it('refuses to rewrite a shipped claim', async () => {
    /*
     * Asserted as "nothing changed" rather than "it errored", which is the
     * distinction tests/db/rls.test.ts already draws: RLS FILTERS, it does not
     * raise. With no write policy the `using` clause matches no row, so the
     * UPDATE succeeds having touched nothing and returns a null error.
     *
     * The insert cases above do error, because `with check` is evaluated
     * against a row that is being created and there is nothing to filter.
     */
    const before = (await table()).rows[0]!;

    const { error } = await user.client
      .from('supplement_evidence')
      .update({ grade: 'A', claim: 'Actually it is great.' })
      .eq('slug', before.slug);

    expect(error, 'an UPDATE that matches no row is not an error').toBeNull();

    const after = (await table()).rows.find((row) => row.slug === before.slug);
    expect(after?.claim, 'the shipped claim changed').toBe(before.claim);
    expect(after?.grade, 'the shipped grade changed').toBe(before.grade);
  });

  it('refuses to delete one', async () => {
    const { rows } = await table();
    await user.client.from('supplement_evidence').delete().eq('slug', rows[0]!.slug);
    expect((await table()).rows.length, 'a row was deleted').toBe(rows.length);
    void adminClient;
  });
});
