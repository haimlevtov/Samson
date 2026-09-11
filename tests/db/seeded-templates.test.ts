/**
 * The workout templates the seed gives each demo user — rework plan PR 5.
 *
 * `src/seed/archetypes.test.ts` covers what `templatesFor` decides, offline.
 * What needs a database is whether the rows the seeder wrote through
 * `createTemplate` come back through the app's own readers intact — sets and
 * reps as the programme prescribes them, in order — and whether every archetype
 * can start a session from one, which is the plan's acceptance in as many words.
 *
 * INVARIANT: every assertion runs through a user-scoped client, so what is
 *            measured is what that archetype sees on the Workout tab.
 *
 * Requires `npm run migrate && npm run seed` first.
 *
 * AI-NOTE: against the HOSTED project this suite fails until hosted has been
 *          re-seeded with the templates change, because the rows it reads do
 *          not exist there yet.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { signInAsArchetype, throughClockSkew, type TestUser } from './helpers';
import { listTemplates, loadTemplate } from '../../src/db/templates';
import { activeWorkout } from '../../src/db/training';
import {
  ARCHETYPES,
  outOfGrant,
  type Archetype,
  type EquipmentOf,
} from '../../src/seed/archetypes';
import { localDateIn } from '../../src/metrics/dates';

const EQUIPMENT_OF: EquipmentOf = new Map(
  (
    JSON.parse(readFileSync(resolve(process.cwd(), 'data/exercises.snapshot.json'), 'utf8')) as {
      exercises: { slug: string; equipment: string }[];
    }
  ).exercises.map((e) => [e.slug, e.equipment])
);

let users: { archetype: Archetype; user: TestUser }[];

beforeAll(async () => {
  users = await Promise.all(
    ARCHETYPES.map(async (archetype) => ({
      archetype,
      user: await signInAsArchetype(archetype.email),
    }))
  );
}, 60_000);

describe('the Workout tab for each demo user', () => {
  it('lists one template per session of the rotation, all of them the user’s own', async () => {
    for (const { archetype, user } of users) {
      const templates = await listTemplates(user.client);

      expect(templates.map((t) => t.name).sort(), archetype.key).toEqual([
        'Day A',
        'Day B',
        'Day C',
      ]);
      /*
       * 'user', not 'coach'. `coach` means imported from an accepted plan —
       * docs/specs/workout-templates.md §1 — and nothing seeded was. FOUND IN
       * REVIEW: this used to say "a different surface and a later PR", which
       * was wrong; the coach import already ships.
       */
      expect(new Set(templates.map((t) => t.source)), archetype.key).toEqual(new Set(['user']));
    }
  });

  it('stores each session as the programme prescribes it, in order, every lift named', async () => {
    /*
     * "Intact" means sets and reps, in order — the parts of a template that do
     * not depend on the date the seed ran. The loads do, because they follow
     * the history, so they are held to the ceiling below rather than to an
     * exact figure.
     */
    for (const { archetype, user } of users) {
      const excluded = new Set(outOfGrant(archetype, EQUIPMENT_OF));

      for (const summary of await listTemplates(user.client)) {
        const template = await loadTemplate(user.client, summary.id);
        const label = `${archetype.key} ${summary.name}`;
        const day = summary.name.charCodeAt(summary.name.length - 1) - 65; // "Day A" is 0
        const prescribed = archetype.programme.filter(
          (e) => e.day === day && !excluded.has(e.exerciseSlug)
        );

        expect(template, label).not.toBeNull();
        expect(
          template!.items.map((i) => [i.setCount, i.reps]),
          label
        ).toEqual(prescribed.map((e) => [e.sets, e.reps]));
        // Contiguous from zero: createTemplate writes position = index, and the
        // session grid allocates logged sets in exactly this order.
        expect(
          template!.items.map((i) => i.position),
          label
        ).toEqual(template!.items.map((_, i) => i));
        // loadTemplate's fallback for a broken join — a seeded id that did not
        // resolve to a catalogue row shows up as this, not as an error.
        expect(
          template!.items.filter((i) => i.exerciseName === 'Unknown exercise'),
          label
        ).toEqual([]);
      }
    }
  });

  it('never prescribes above an archetype’s equipment ceiling', async () => {
    const capped = users.filter(({ archetype }) => archetype.loadCeilingKg !== undefined);
    // Without this the loop below runs zero checks the day the cap is removed.
    expect(capped.length).toBeGreaterThan(0);

    for (const { archetype, user } of capped) {
      for (const summary of await listTemplates(user.client)) {
        for (const item of (await loadTemplate(user.client, summary.id))!.items) {
          if (item.weightKg !== null) {
            expect(item.weightKg, `${archetype.key} ${item.exerciseName}`).toBeLessThanOrEqual(
              archetype.loadCeilingKg!
            );
          }
        }
      }
    }
  });

  it('starts a session from a template, for every archetype, and leaves nothing behind', async () => {
    /*
     * `startFromTemplate` is a server action and cannot be called from here, so
     * this does what it does: refuse when a session is already running, then
     * the same insert — same status, the user's own local date (CLAUDE.md #9) —
     * through the same user-scoped client.
     *
     * WHAT THIS DOES NOT PROVE: that another user's template would be refused.
     * FOUND IN REVIEW, this comment said "RLS rejects a template id belonging to
     * anyone else", and it does not — `workouts_own` checks only `user_id`, and
     * a foreign key is not subject to RLS. What proves this user owns the
     * template is `listTemplates` having returned it through RLS at all. The
     * policy gap is its own piece of work, and app/workout/actions.ts makes the
     * same false claim until it lands.
     *
     * The row is deleted afterwards and the delete is CHECKED. Against the
     * hosted project a stray in-progress session would become that demo user's
     * active one, and the next Start pressed by anybody would land in it.
     */
    for (const { archetype, user } of users) {
      const [first] = await listTemplates(user.client);
      expect(
        await activeWorkout(user.client),
        `${archetype.key} already has a session running`
      ).toBeNull();

      const { data, error } = await user.client
        .from('workouts')
        .insert({
          user_id: user.id,
          local_date: localDateIn(archetype.timezone),
          status: 'in_progress',
          started_at: new Date().toISOString(),
          template_id: first!.id,
        })
        .select('id, template_id')
        .single();

      try {
        expect(error, archetype.key).toBeNull();
        expect(data!.template_id, archetype.key).toBe(first!.id);
      } finally {
        if (data) {
          await throughClockSkew(
            () => user.client.from('workouts').delete().eq('id', data.id),
            `removing the ${archetype.key} test session`
          );
        }
      }

      expect(
        await activeWorkout(user.client),
        `${archetype.key}: the test session was not removed`
      ).toBeNull();
    }
  });
});
