/**
 * INVARIANT: the planner selects only from a pre-filtered candidate list, and
 *            equipment filtering happens in SQL — CLAUDE.md #5.
 *
 * These run against the seeded database, because the home-gym archetype exists
 * precisely to make a violation obvious: it owns dumbbells, bands and a body,
 * and nothing else. If a barbell lift reaches its candidate list, the filter is
 * not doing its job.
 *
 * Requires `npm run migrate && npm run seed` first.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { ANON_KEY, SUPABASE_URL, adminClient, type Client } from './helpers';
import { availableExercises, userEquipment } from '../../src/db/exercises';
import type { Db } from '../../src/db/client';

interface Seeded {
  id: string;
  client: Db;
}

async function signIn(email: string): Promise<Seeded> {
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: 'samson-demo-fixture',
  });
  if (error || !data.session) {
    throw new Error(
      `could not sign in ${email} (${error?.message}). Run: npm run migrate && npm run seed`
    );
  }

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  return { id: data.session.user.id, client: client as unknown as Db };
}

let homeGym: Seeded;
let beginner: Seeded;

beforeAll(async () => {
  [homeGym, beginner] = await Promise.all([
    signIn('homegym@samson.test'),
    signIn('beginner@samson.test'),
  ]);
});

describe('equipment-filtered candidates', () => {
  it('gives the home-gym user nothing that needs a barbell', async () => {
    const candidates = await availableExercises(homeGym.client, homeGym.id);
    expect(candidates.length).toBeGreaterThan(20);

    const barbellLifts = candidates.filter((c) => c.slug.includes('barbell'));
    expect(barbellLifts.map((c) => c.slug)).toEqual([]);
  });

  it('gives the fully equipped user strictly more to choose from', async () => {
    const limited = await availableExercises(homeGym.client, homeGym.id);
    const full = await availableExercises(beginner.client, beginner.id);
    expect(full.length).toBeGreaterThan(limited.length);
    expect(full.some((c) => c.slug.startsWith('barbell-'))).toBe(true);
  });

  it('records the load ceiling on capped equipment', async () => {
    // Owning dumbbells is not the same as being able to press 40 kg with them.
    const equipment = await userEquipment(homeGym.client, homeGym.id);
    const dumbbell = equipment.find((e) => e.slug === 'dumbbell');
    expect(dumbbell?.maxLoadKg).toBe(30);
    expect(equipment.find((e) => e.slug === 'bodyweight')?.maxLoadKg).toBeNull();
  });

  it('excludes stretching and cardio unless asked for them', async () => {
    const programmable = await availableExercises(beginner.client, beginner.id);
    expect(programmable.every((c) => c.category !== 'stretching')).toBe(true);

    const everything = await availableExercises(beginner.client, beginner.id, {
      allCategories: true,
    });
    expect(everything.length).toBeGreaterThan(programmable.length);
  });

  it('narrows to a movement pattern for a given training day', async () => {
    const pressing = await availableExercises(beginner.client, beginner.id, {
      movementPatterns: ['push'],
    });
    expect(pressing.length).toBeGreaterThan(0);
    expect(pressing.every((c) => c.movementPattern === 'push')).toBe(true);
  });

  it('returns nothing rather than everything for a user with no equipment', async () => {
    // AI-NOTE: a "show them all" fallback would hand the planner a barbell for
    //          someone who owns none, and it would read as a model mistake.
    const admin = adminClient() as unknown as Client;
    const bare = await admin.auth.admin.createUser({
      email: `bare-${Date.now()}@samson.test`,
      password: 'samson-demo-fixture',
      email_confirm: true,
    });
    const userId = bare.data.user!.id;
    await admin.from('users').insert({ user_id: userId, timezone: 'UTC' });

    try {
      const candidates = await availableExercises(admin as unknown as Db, userId);
      expect(candidates).toEqual([]);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });
});

describe('seeded history', () => {
  it('gives every archetype at least eight weeks of workouts', async () => {
    for (const email of [
      'beginner@samson.test',
      'plateaued@samson.test',
      'returning@samson.test',
      'homegym@samson.test',
      'inconsistent@samson.test',
    ]) {
      const user = await signIn(email);
      const { data, error } = await user.client
        .from('workouts')
        .select('local_date')
        .order('local_date');
      expect(error, email).toBeNull();
      expect(data!.length, email).toBeGreaterThan(20);
    }
  });

  it('never logs a set above the home-gym load ceiling', async () => {
    const { data } = await homeGym.client
      .from('sets')
      .select('weight_kg')
      .not('weight_kg', 'is', null);
    for (const row of data ?? []) expect(Number(row.weight_kg)).toBeLessThanOrEqual(30);
  });
});
