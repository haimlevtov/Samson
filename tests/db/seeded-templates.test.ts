/**
 * The workout templates the seed gives each demo user — rework plan PR 5.
 *
 * `src/seed/archetypes.test.ts` covers what `templatesFor` decides, offline.
 * What needs a database is whether the rows the seeder wrote through
 * `createTemplate` come back through the app's own readers intact — and whether
 * one can start a session, which is the plan's acceptance in as many words.
 *
 * INVARIANT: every assertion runs through a user-scoped client, so what is
 *            measured is what that archetype sees on the Workout tab.
 *
 * Requires `npm run migrate && npm run seed` first.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { signInAsArchetype, type TestUser } from './helpers';
import { listTemplates, loadTemplate } from '../../src/db/templates';
import { ARCHETYPES } from '../../src/seed/archetypes';
import { localDateIn } from '../../src/metrics/dates';

let users: { key: string; timezone: string; ceiling: number | undefined; user: TestUser }[];

beforeAll(async () => {
  users = await Promise.all(
    ARCHETYPES.map(async (archetype) => ({
      key: archetype.key,
      timezone: archetype.timezone,
      ceiling: archetype.loadCeilingKg,
      user: await signInAsArchetype(archetype.email),
    }))
  );
}, 60_000);

describe('the Workout tab for each demo user', () => {
  it('lists one template per session of the rotation, all of them the user own', async () => {
    for (const { key, user } of users) {
      const templates = await listTemplates(user.client);

      expect(templates.map((t) => t.name).sort(), key).toEqual(['Day A', 'Day B', 'Day C']);
      // 'user', not 'coach': coach templates come from importing an accepted
      // plan, which is a different surface and a later PR.
      expect(new Set(templates.map((t) => t.source)), key).toEqual(new Set(['user']));
    }
  });

  it('loads every template with its lifts in order and every lift named', async () => {
    for (const { key, user } of users) {
      for (const summary of await listTemplates(user.client)) {
        const template = await loadTemplate(user.client, summary.id);
        const label = `${key} ${summary.name}`;

        expect(template, label).not.toBeNull();
        expect(template!.items.length, label).toBeGreaterThan(0);
        // Contiguous from zero: createTemplate writes position = index, and the
        // session grid allocates logged sets in exactly this order.
        expect(
          template!.items.map((i) => i.position),
          label
        ).toEqual(template!.items.map((_, i) => i));
        // loadTemplate's fallback for a broken join — a seeded id that did not
        // resolve to a catalogue row would show up as this, not as an error.
        expect(
          template!.items.filter((i) => i.exerciseName === 'Unknown exercise'),
          label
        ).toEqual([]);
      }
    }
  });

  it('never prescribes above an archetype equipment ceiling', async () => {
    // The home-gym lifter's dumbbells stop at 30 kg. Asserted here as well as
    // offline because this is the row they would actually press Start on.
    for (const { key, ceiling, user } of users.filter((u) => u.ceiling !== undefined)) {
      for (const summary of await listTemplates(user.client)) {
        const template = await loadTemplate(user.client, summary.id);
        for (const item of template!.items) {
          if (item.weightKg !== null) {
            expect(item.weightKg, `${key} ${item.exerciseName}`).toBeLessThanOrEqual(ceiling!);
          }
        }
      }
    }
  });

  it('starts a session the way the Start button does', async () => {
    /*
     * `startFromTemplate` is a server action and cannot be called from here, so
     * this makes its insert — the same row, the same status, the user's own
     * local date (CLAUDE.md #9) — through the same user-scoped client. RLS
     * rejects a template id belonging to anyone else, so success here means the
     * seeded template is one this user can actually start.
     *
     * The row is deleted afterwards: the seeded history is read by other suites
     * and a stray in-progress session would be the user's "active" one.
     */
    const { key, timezone, user } = users.find((u) => u.key === 'home-gym')!;
    const [first] = await listTemplates(user.client);

    const { data, error } = await user.client
      .from('workouts')
      .insert({
        user_id: user.id,
        local_date: localDateIn(timezone),
        status: 'in_progress',
        started_at: new Date().toISOString(),
        template_id: first!.id,
      })
      .select('id, template_id')
      .single();

    try {
      expect(error, key).toBeNull();
      expect(data!.template_id).toBe(first!.id);
    } finally {
      if (data) await user.client.from('workouts').delete().eq('id', data.id);
    }
  });
});
