/**
 * The challenges the seed puts in front of each demo user.
 *
 * `src/gamification/assignment.test.ts` covers the decision offline. What needs
 * a database is the CONTENT — whether the shipped pool is calibrated so that
 * every archetype actually has something to accept, which is the thing that was
 * broken: the machinery all worked, and three of five users were offered
 * nothing because every pool target sat below what they already do.
 *
 * The same split as `evidence.test.ts`: rows, not logic.
 *
 * INVARIANT: every assertion runs through a user-scoped client, so what is
 *            measured is what that user can actually see on the Hub.
 *
 * Requires `npm run migrate && npm run seed` first.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, signInAsArchetype, type TestUser } from './helpers';
import { loadChallenges } from '../../src/db/gamification';
import { ARCHETYPES } from '../../src/seed/archetypes';

/** Every seeded archetype, signed in. */
let users: { key: string; user: TestUser }[];

beforeAll(async () => {
  users = await Promise.all(
    ARCHETYPES.map(async (archetype) => ({
      key: archetype.key,
      user: await signInAsArchetype(archetype.email),
    }))
  );
}, 60_000);

describe('what each demo user finds on the Hub', () => {
  /*
   * The acceptance criterion, and the regression guard for this whole change.
   *
   * It is written per archetype rather than as an aggregate deliberately: an
   * aggregate passes while three users have nothing, which is exactly the state
   * that shipped. `expect` carries the key so a failure names who is empty.
   */
  it('offers every archetype at least one challenge it can accept', async () => {
    for (const { key, user } of users) {
      const rows = await loadChallenges(user.client);
      const offered = rows.filter((c) => c.status === 'offered');

      expect(
        offered.length,
        `${key} was offered nothing — is the pool calibrated below what this ` +
          `archetype already does? See 20260909140000_challenge_pool_second_rung.sql`
      ).toBeGreaterThan(0);
    }
  });

  it('puts exactly one challenge in play for every archetype', async () => {
    for (const { key, user } of users) {
      const active = (await loadChallenges(user.client)).filter((c) => c.status === 'active');
      expect(active.length, `${key} has ${active.length} active`).toBe(1);
    }
  });

  it('leaves every archetype a rejected one to inspect', async () => {
    /*
     * PLAN.md phase 4: "a rejected challenge is inspectable — the validator
     * logs why". The Hub renders that list, and with no rejected rows anywhere
     * in the demo database that half of the surface is never seen.
     */
    for (const { key, user } of users) {
      const rejected = (await loadChallenges(user.client)).filter((c) => c.status === 'rejected');
      expect(rejected.length, `${key} has no rejected challenge`).toBeGreaterThan(0);
    }
  });

  it('gives every rejected challenge a reason, and every offered one none', async () => {
    for (const { key, user } of users) {
      for (const row of await loadChallenges(user.client)) {
        if (row.status === 'rejected') {
          expect(row.validationReasons.length, `${key} · ${row.slug}`).toBeGreaterThan(0);
          for (const reason of row.validationReasons) {
            // A detail that names no number is the thing ADR 0008 exists to
            // prevent: a human reads this string and has to learn something.
            expect(reason.detail, `${key} · ${row.slug} · ${reason.code}`).not.toBe('');
          }
        } else {
          expect(row.validationReasons, `${key} · ${row.slug}`).toEqual([]);
        }
      }
    }
  });

  it('reads every seeded spec back through the schema', async () => {
    /*
     * `loadChallenges` sets `spec` to null for a row that fails validation,
     * because there is no safe way to render a challenge whose target did not
     * parse. That is right, and it makes a content error invisible — the Hub
     * shows "unreadable" and moves on. Counted here, where it is visible.
     */
    for (const { key, user } of users) {
      const unreadable = (await loadChallenges(user.client)).filter((c) => c.spec === null);
      expect(
        unreadable.map((c) => c.slug),
        key
      ).toEqual([]);
    }
  });
});

describe('the rows the seeder wrote', () => {
  it('never assigns the same template twice to one user', async () => {
    for (const { key, user } of users) {
      const slugs = (await loadChallenges(user.client)).map((c) => c.slug);
      expect(slugs.length - new Set(slugs).size, `${key} has a duplicate slug`).toBe(0);
    }
  });

  it('gives every assigned challenge a window that has not closed', async () => {
    /*
     * The seeder writes `window_start` as the day it ran and `window_end` from
     * the spec's length. A closed window on a freshly seeded database would
     * mean the Hub renders "its window closed on …" for a demo user, and
     * `accept_challenge` would refuse the Accept button next to it.
     */
    const today = new Date().toISOString().slice(0, 10);
    for (const { key, user } of users) {
      for (const row of await loadChallenges(user.client)) {
        expect(row.windowEnd, `${key} · ${row.slug} has no window`).not.toBeNull();
        expect(row.windowEnd! >= today, `${key} · ${row.slug} closed on ${row.windowEnd}`).toBe(
          true
        );
      }
    }
  });

  it('reached `active` through accept_challenge, so its window is still open', async () => {
    /*
     * The RPC refuses a challenge whose window has closed, so an active row
     * inside its window is consistent with having been accepted. It is a proxy
     * — nothing records HOW a row reached its status — but it is the assertion
     * that would fail if a future seeder took the shortcut of inserting
     * `status: 'active'` directly, on a day when the window arithmetic is
     * wrong.
     */
    const today = new Date().toISOString().slice(0, 10);
    for (const { key, user } of users) {
      const active = (await loadChallenges(user.client)).find((c) => c.status === 'active');
      expect(active, `${key} has nothing active`).toBeDefined();
      expect(active!.windowStart! <= today, `${key} · ${active!.slug} starts in the future`).toBe(
        true
      );
      expect(active!.windowEnd! >= today, `${key} · ${active!.slug} has closed`).toBe(true);
    }
  });
});

describe('the pool itself', () => {
  /*
   * Pool rows have a null `user_id`, which is what makes them templates rather
   * than anybody's challenge.
   */
  it('is readable by any signed-in user, and kept off the Hub in TypeScript', async () => {
    /*
     * `challenges_read` is `user_id is null or user_id = auth.uid()`, so the
     * templates are deliberately visible to everyone — they are content, like
     * the exercise catalogue, and the batch has to be able to see them.
     *
     * So the thing that keeps them off the Hub is `loadChallenges`'s
     * `.not('user_id', 'is', null)`, not RLS. Both halves are asserted here
     * because dropping that filter would render seven unassigned templates on
     * every user's Hub with no window and no Accept button, and no policy would
     * stop it.
     */
    const first = users[0]!;
    const { data: visible, error } = await first.user.client
      .from('challenges')
      .select('slug')
      .is('user_id', null);
    expect(error).toBeNull();
    expect(visible!.length).toBeGreaterThan(0);

    const onTheHub = await loadChallenges(first.user.client);
    expect(onTheHub.length).toBeGreaterThan(0);
    expect(onTheHub.every((row) => row.windowStart !== null)).toBe(true);
  });

  it('is left unassigned by seeding, so the cron still has something to draw from', async () => {
    const { data, error } = await adminClient()
      .from('challenges')
      .select('slug, status, window_start')
      .is('user_id', null);

    expect(error).toBeNull();
    expect(data!.length, 'the pool is empty — has 20260902090200 been applied?').toBeGreaterThan(0);
    // A template is `offered` with no window: the window is written when it is
    // assigned to somebody, from the day that happened.
    expect(data!.every((row) => row.status === 'offered' && row.window_start === null)).toBe(true);
  });

  it('carries a second rung for the kinds that can have one', async () => {
    /*
     * Not a count — a count passes whatever the rows are. These four are the
     * ones calibrated above a consistent lifter's rolling week, and deleting
     * one puts an archetype back to an empty Hub.
     *
     * There is no `streak_days` rung here on purpose: progress is
     * `min(currentStreak, window_days)` and the schema caps `window_days` at
     * 14, so no legal streak challenge can be offered to anyone whose streak
     * has reached a fortnight. See docs/specs/xp-and-challenges.md.
     */
    const { data } = await adminClient().from('challenges').select('slug').is('user_id', null);
    const slugs = (data ?? []).map((row) => row.slug);

    for (const slug of [
      'daily-six-movements',
      'daily-six-hard-sets',
      'weekly-five-sessions',
      'weekly-twenty-five-hard-sets',
    ]) {
      expect(slugs, `${slug} is missing from the pool`).toContain(slug);
    }
  });
});
