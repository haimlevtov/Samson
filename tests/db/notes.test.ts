/**
 * What the coach remembers, against Postgres — ADR 0030.
 *
 * Three things only a database can answer: whether one user can reach another's
 * notes, whether the twenty-note bound actually holds, and whether the column's
 * own CHECK refuses what the application would refuse.
 *
 * INVARIANT: the service role creates fixtures; every assertion about what a
 *            user can do runs through a user-scoped client — as in rls.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_NOTES, MAX_NOTE_CHARS } from '../../src/chat/notes';
import { forgetNote, loadNotes, rememberNote } from '../../src/db/notes';
import { Client as PgClient } from 'pg';
import { DB_URL, adminClient, createTestUser, deleteTestUsers, type TestUser } from './helpers';

let user: TestUser;
let other: TestUser;

beforeAll(async () => {
  [user, other] = await Promise.all([createTestUser('notes'), createTestUser('notes-other')]);
}, 90_000);

afterAll(async () => {
  await deleteTestUsers(user, other);
});

/** Reads with the service role, so an assertion about rows is about truth. */
const rowsOf = async (id: string) => {
  const { data, error } = await adminClient()
    .from('coach_notes')
    .select('id, text, created_at')
    .eq('user_id', id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
};

const clear = async (id: string) => {
  const { error } = await adminClient().from('coach_notes').delete().eq('user_id', id);
  if (error) throw new Error(error.message);
};

describe('a note belongs to one user', () => {
  it('is invisible to everybody else', async () => {
    await clear(user.id);
    await clear(other.id);

    await rememberNote(user.client, user.id, 'reported a sore left shoulder');
    await rememberNote(other.client, other.id, 'wants to bring up their calves');

    expect((await loadNotes(user.client)).map((n) => n.text)).toEqual([
      'reported a sore left shoulder',
    ]);
    expect((await loadNotes(other.client)).map((n) => n.text)).toEqual([
      'wants to bring up their calves',
    ]);
  });

  it('cannot be written onto somebody else', async () => {
    // `with check (user_id = auth.uid())`. The application never passes another
    // id, so this is the policy being asked directly.
    const { error } = await user.client
      .from('coach_notes')
      .insert({ user_id: other.id, text: 'planted by another user' });

    expect(error).not.toBeNull();
  });

  it('cannot be deleted by somebody else', async () => {
    await clear(other.id);
    await rememberNote(other.client, other.id, 'the other user owns this');
    const [planted] = await rowsOf(other.id);

    // RLS makes the row unmatchable rather than the delete an error, so the
    // check that means anything is that the row survives.
    await forgetNote(user.client, user.id, planted!.id);
    expect(await rowsOf(other.id)).toHaveLength(1);

    await forgetNote(other.client, other.id, planted!.id);
    expect(await rowsOf(other.id)).toHaveLength(0);
  });
});

describe('the twenty-note bound', () => {
  it('keeps the newest and drops the oldest', async () => {
    await clear(user.id);

    // Written one at a time, because the trigger fires per row and because
    // `created_at` defaults to transaction time — a single bulk insert would
    // give every row one value and prove nothing about ordering.
    for (let n = 0; n < MAX_NOTES + 5; n++) {
      await rememberNote(user.client, user.id, `note number ${'a'.repeat(n + 1)}`);
    }

    const rows = await rowsOf(user.id);
    expect(rows).toHaveLength(MAX_NOTES);

    // The five oldest are the ones gone.
    expect(rows.map((r) => r.text)).toContain(`note number ${'a'.repeat(MAX_NOTES + 5)}`);
    expect(rows.map((r) => r.text)).not.toContain('note number a');
  });

  it('holds for a row the application did not write', async () => {
    // The point of the trigger rather than a delete in the action: the RLS
    // policy lets an authenticated user POST here directly, and a bound
    // enforced only by the one caller is a bound until the second caller.
    await clear(user.id);
    for (let n = 0; n < MAX_NOTES + 3; n++) {
      const { error } = await user.client
        .from('coach_notes')
        .insert({ user_id: user.id, text: `direct write ${'b'.repeat(n + 1)}` });
      expect(error).toBeNull();
    }

    expect(await rowsOf(user.id)).toHaveLength(MAX_NOTES);
  });
});

describe('the reader, which is the bound ADR 0030 calls the control', () => {
  /*
   * FOUND IN REVIEW, and the first attempt at this test did not work: every
   * other case here leaves at most twenty rows because the trigger clears them,
   * so deleting `.limit(MAX_NOTES)` from `loadNotes` broke nothing — including
   * a version of this test that planted twenty-five with the service role. The
   * trigger is a TABLE trigger and does not care who is inserting.
   *
   * So the trigger is disabled for the duration, over a direct Postgres
   * connection, which is the only way to reach the state the reader's LIMIT
   * exists for: a table that has more rows than the prompt may carry. That state
   * is exactly what ADR 0030 §3 says the limit is insurance against — "a trigger
   * is a thing that can be dropped by a migration".
   */
  let pg: PgClient;

  beforeAll(async () => {
    pg = new PgClient({ connectionString: DB_URL });
    await pg.connect();
  }, 30_000);

  afterAll(async () => {
    await pg.end();
  });

  it('returns the newest twenty even when the table holds more', async () => {
    await clear(user.id);
    await pg.query('alter table public.coach_notes disable trigger coach_notes_trim');

    try {
      const admin = adminClient();
      for (let n = 0; n < MAX_NOTES + 5; n++) {
        const { error } = await admin.from('coach_notes').insert({
          user_id: user.id,
          text: `planted ${'z'.repeat(n + 1)}`,
          created_at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
        });
        if (error) throw new Error(error.message);
      }

      // The premise: without the trigger the table really does hold more.
      expect(await rowsOf(user.id)).toHaveLength(MAX_NOTES + 5);

      const read = await loadNotes(user.client);
      expect(read).toHaveLength(MAX_NOTES);
      // Newest first, and the newest planted row leads.
      expect(read[0]!.text).toBe(`planted ${'z'.repeat(MAX_NOTES + 5)}`);
      const times = read.map((n) => n.createdAt);
      expect([...times].sort().reverse()).toEqual(times);
    } finally {
      await pg.query('alter table public.coach_notes enable trigger coach_notes_trim');
      await clear(user.id);
    }
  });
});

describe('the column refuses what the application refuses', () => {
  it('rejects a note longer than the bound', async () => {
    // The application drops these before they get here — `acceptableNote`.
    // This is the bound that survives a hand-written POST, which is the only
    // reason it is also a CHECK.
    const { error } = await user.client
      .from('coach_notes')
      .insert({ user_id: user.id, text: 'c'.repeat(MAX_NOTE_CHARS + 1) });

    expect(error).not.toBeNull();
  });

  it('rejects an empty note', async () => {
    const { error } = await user.client.from('coach_notes').insert({ user_id: user.id, text: '' });

    expect(error).not.toBeNull();
  });
});
