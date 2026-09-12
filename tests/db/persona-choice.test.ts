/**
 * The coach a user picked — `users.persona_slug`, 20260912210000.
 *
 * WHY this needs a database. The column carries NO foreign key, deliberately,
 * and the argument for that is a property of the schema rather than of any
 * function: `personas` is unique on `(user_id, slug)` so there is nothing to
 * point at, and `is_active` retires a coach without deleting its row so a
 * dangling slug is reachable with an FK fully satisfied. The integrity is
 * `saveCoach`'s read of `listPersonas`, which unit tests can mock and therefore
 * cannot prove.
 *
 * INVARIANT: the service role creates fixtures; every assertion runs through a
 *            user-scoped client — the same split as tests/db/rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient, createTestUser, deleteTestUsers, type TestUser } from './helpers';

let mine: TestUser;
let theirs: TestUser;

beforeAll(async () => {
  /*
   * SEQUENTIALLY, and this is not style. Two `admin.createUser` calls in flight
   * at once made GoTrue answer "Database error checking email" on the second,
   * intermittently — a flake in a suite that would then look like an RLS
   * failure. Every other file here creates its users one at a time.
   */
  mine = await createTestUser('persona-choice-mine');
  theirs = await createTestUser('persona-choice-theirs');
}, 60_000);

afterAll(async () => {
  // Whatever got made. `beforeAll` can fail after the first one, and a cleanup
  // that throws on undefined hides the failure that actually happened.
  await deleteTestUsers(...[mine, theirs].filter((user) => user !== undefined));
});

/** A slug the shipped catalogue really has, so the happy path is a real one. */
async function aShippedSlug(): Promise<string> {
  const { data, error } = await adminClient()
    .from('personas')
    .select('slug')
    .is('user_id', null)
    .eq('is_active', true)
    .order('slug')
    .limit(1);
  if (error) throw new Error(`reading personas: ${error.message}`);
  const slug = data?.[0]?.slug;
  if (!slug) throw new Error('no shared persona rows — the catalogue migration did not run');
  return slug;
}

describe('users.persona_slug', () => {
  it('stores the coach its owner picked', async () => {
    const slug = await aShippedSlug();

    const { error } = await mine.client
      .from('users')
      .upsert({ user_id: mine.id, persona_slug: slug }, { onConflict: 'user_id' });
    expect(error).toBeNull();

    const { data } = await mine.client
      .from('users')
      .select('persona_slug')
      .eq('user_id', mine.id)
      .maybeSingle();
    expect(data?.persona_slug).toBe(slug);
  });

  it('lets nobody else choose it for them', async () => {
    /*
     * The assertion is the ROW, not the error. `authenticated` holds the UPDATE
     * grant, so RLS filters this to zero rows and PostgREST answers 204 — a
     * silent success. A test that expected `error` to be non-null would pass
     * against a policy that had been dropped entirely.
     */
    const slug = await aShippedSlug();
    const admin = adminClient();

    await admin
      .from('users')
      .upsert({ user_id: theirs.id, persona_slug: slug }, { onConflict: 'user_id' });

    await mine.client.from('users').update({ persona_slug: 'rival' }).eq('user_id', theirs.id);

    const { data } = await admin
      .from('users')
      .select('persona_slug')
      .eq('user_id', theirs.id)
      .maybeSingle();
    expect(data?.persona_slug).toBe(slug);
  });

  it('takes a slug that names no coach, because the check is code and not a key', async () => {
    /*
     * This pins a DECISION rather than guarding a behaviour, and it is meant to
     * fail loudly if somebody adds the foreign key the plan for this PR wrongly
     * said would be here. Two reasons it is not:
     *
     *   1. `personas` is unique on `(user_id, slug)` with `nulls not distinct`,
     *      so there is no unique on `slug` alone to reference. Adding one would
     *      forbid a user-owned persona from sharing a slug with a shared one —
     *      a change to the content table to serve a preference column.
     *   2. It would not buy what it looks like. A coach is retired with
     *      `is_active = false`, not by deletion, so "the stored slug names a
     *      coach the picker no longer lists" survives the constraint. Readers
     *      must fall back regardless, and once they do the key removes no case
     *      the app can feel.
     *
     * What stops a nonsense slug being written is `saveCoach`, which checks the
     * posted value against the rows `listPersonas` returned.
     */
    const { error } = await mine.client
      .from('users')
      .update({ persona_slug: 'no-such-coach-exists' })
      .eq('user_id', mine.id);
    expect(error).toBeNull();

    const { data } = await mine.client
      .from('users')
      .select('persona_slug')
      .eq('user_id', mine.id)
      .maybeSingle();
    expect(data?.persona_slug).toBe('no-such-coach-exists');
  });

  it('is null for a user who has never been asked', async () => {
    // "Has not chosen" and "chose the first one" are different, which is the
    // whole reason the column is nullable — the same shape `diet_goal` uses.
    const fresh = await createTestUser('persona-choice-fresh');
    try {
      const { data } = await fresh.client
        .from('users')
        .select('persona_slug')
        .eq('user_id', fresh.id)
        .maybeSingle();
      // A seeded row, or no row at all. Either way there is no coach on it.
      expect(data?.persona_slug ?? null).toBeNull();
    } finally {
      await deleteTestUsers(fresh);
    }
  }, 60_000);
});
