/**
 * Builds a complete, demoable database from an empty schema.
 *
 *   npm run migrate && npm run seed
 *
 * PLAN.md calls this critical-path work that looks disposable: without plausible
 * history there is nothing to develop or evaluate the phase 2 planner against,
 * and real history takes months to accumulate.
 *
 * WHY the service role: this creates auth users and system catalogue rows that
 * belong to nobody, neither of which is possible under RLS. CLAUDE.md #10
 * forbids the service role in *application* code, and tests/unit/invariants.test.ts
 * asserts it never appears under src/ or app/. A seed script is neither.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ARCHETYPES, generateHistory, type Archetype } from '../src/seed/archetypes';
import { mulberry32 } from '../src/seed/rng';
import { supabaseUrl } from '../src/db/client';
import { buildPlannerContext } from '../src/planner/context';
import { candidatesFor } from '../tests/planner/golden';
import { compliantBlock } from '../tests/planner/stub-planner';
import type { Database } from '../src/db/types';

config({ path: '.env.local', quiet: true });

/** Fixed so the database is byte-identical on every run. */
const SEED = 42;
const SNAPSHOT = resolve(process.cwd(), 'data/exercises.snapshot.json');
const BATCH = 500;

type Admin = SupabaseClient<Database>;

interface Snapshot {
  count: number;
  license: string;
  equipmentTags: { slug: string; name: string }[];
  exercises: {
    slug: string;
    name: string;
    primaryMuscle: string;
    secondaryMuscles: string[];
    movementPattern: string | null;
    isUnilateral: boolean;
    category: string;
    instructions: string | null;
    source: string;
    sourceId: string;
    equipment: string;
  }[];
}

function adminClient(): Admin {
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to seed.');
  return createClient<Database>(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Constrained to real tables so a typo cannot reach the database. */
type TableName = keyof Database['public']['Tables'];

async function insertBatched(
  admin: Admin,
  table: TableName,
  rows: readonly Record<string, unknown>[],
  label: string
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await admin.from(table).insert(chunk as never);
    if (error) throw new Error(`${label}: ${error.message}`);
  }
}

/**
 * Removes anything a previous run created so the script is re-runnable.
 * Deleting the auth user cascades to their profile, workouts, sets and ledger.
 */
async function clean(admin: Admin): Promise<void> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`listing users: ${error.message}`);

  const seeded = data.users.filter((u) => u.email?.endsWith('@samson.test'));
  for (const user of seeded) await admin.auth.admin.deleteUser(user.id);

  // System catalogue rows have a NULL user_id, so nothing cascades them.
  const catalogueTables: TableName[] = ['exercise_equipment', 'exercises', 'equipment_tags'];
  for (const table of catalogueTables) {
    const { error: delError } = await admin.from(table).delete().is('user_id', null);
    if (delError) throw new Error(`clearing ${table}: ${delError.message}`);
  }

  if (seeded.length > 0) console.log(`  removed ${seeded.length} user(s) from a previous run`);
}

async function seedCatalogue(admin: Admin, snapshot: Snapshot): Promise<Map<string, string>> {
  await insertBatched(
    admin,
    'equipment_tags',
    snapshot.equipmentTags.map((t) => ({ slug: t.slug, name: t.name })),
    'equipment_tags'
  );

  const { data: tags, error: tagError } = await admin
    .from('equipment_tags')
    .select('id, slug')
    .is('user_id', null);
  if (tagError) throw new Error(`reading equipment_tags: ${tagError.message}`);
  const tagBySlug = new Map(tags!.map((t) => [t.slug, t.id]));

  await insertBatched(
    admin,
    'exercises',
    snapshot.exercises.map((e) => ({
      slug: e.slug,
      name: e.name,
      primary_muscle: e.primaryMuscle,
      secondary_muscles: e.secondaryMuscles,
      movement_pattern: e.movementPattern,
      is_unilateral: e.isUnilateral,
      category: e.category,
      instructions: e.instructions,
      source: e.source,
      source_id: e.sourceId,
    })),
    'exercises'
  );

  const { data: exercises, error: exError } = await admin
    .from('exercises')
    .select('id, slug')
    .is('user_id', null);
  if (exError) throw new Error(`reading exercises: ${exError.message}`);
  const exerciseBySlug = new Map(exercises!.map((e) => [e.slug, e.id]));

  // INVARIANT: equipment filtering happens in SQL — CLAUDE.md #5. This join is
  // what makes that possible, so it is seeded alongside the exercises rather
  // than left for later.
  await insertBatched(
    admin,
    'exercise_equipment',
    snapshot.exercises
      .map((e) => ({
        exercise_id: exerciseBySlug.get(e.slug)!,
        equipment_tag_id: tagBySlug.get(e.equipment)!,
      }))
      .filter((row) => row.exercise_id && row.equipment_tag_id),
    'exercise_equipment'
  );

  console.log(
    `  ${snapshot.equipmentTags.length} equipment tags, ${snapshot.exercises.length} exercises`
  );
  return exerciseBySlug;
}

/** Four weeks is long enough to show progression, short enough to read on a phone. */
const PLAN_WEEKS = 4;

/**
 * Compound patterns first, so the seeded plan reads like training.
 *
 * WHY this is here and not in compliantBlock: that stub's only job is to satisfy
 * the six rules in src/planner/rules.ts, and it does that by taking whatever
 * candidates come first. In catalogue order that is alphabetical, which produced
 * a demo plan of five sets of sit-ups and an air bike — rule-valid and obviously
 * not a training block.
 *
 * Sorting here keeps the shared stub untouched and the golden suite unaffected.
 * It is also honest about what it is: the seeder choosing plausible-looking demo
 * content, not a planner choosing exercises. A real plan comes from
 * src/planner/, and that needs a key.
 */
const PATTERN_RANK: Record<string, number> = {
  squat: 0,
  hinge: 1,
  push: 2,
  pull: 3,
  carry: 4,
  core: 5,
  isolation: 6,
};

function plausibleFirst<T extends { movementPattern: string | null }>(candidates: T[]): T[] {
  // Round-robin across patterns rather than sorting by them. Sorting put four
  // squat variants in the same session, which is rule-valid and still reads as
  // nonsense to anyone who lifts. Interleaving gives a session one of each.
  const byPattern = new Map<number, T[]>();
  for (const candidate of candidates) {
    const rank = PATTERN_RANK[candidate.movementPattern ?? ''] ?? 9;
    byPattern.set(rank, [...(byPattern.get(rank) ?? []), candidate]);
  }

  const groups = [...byPattern.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
  const ordered: T[] = [];
  for (let i = 0; ordered.length < candidates.length; i++) {
    for (const group of groups) {
      const next = group[i];
      if (next !== undefined) ordered.push(next);
    }
  }
  return ordered;
}

async function seedArchetype(
  admin: Admin,
  archetype: Archetype,
  exerciseBySlug: Map<string, string>,
  endDate: string,
  tagBySlug: Map<string, string>
): Promise<{ workouts: number; sets: number }> {
  const created = await admin.auth.admin.createUser({
    email: archetype.email,
    password: 'samson-demo-fixture',
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    throw new Error(`creating ${archetype.email}: ${created.error?.message}`);
  }
  const userId = created.data.user.id;

  const { error: profileError } = await admin.from('users').insert({
    user_id: userId,
    display_name: archetype.displayName,
    // INVARIANT: UTC plus the user's IANA timezone — CLAUDE.md #9. Each
    // archetype lives somewhere different so calendar logic gets exercised.
    timezone: archetype.timezone,
    unit_preference: 'metric',
  });
  if (profileError) throw new Error(`profile for ${archetype.key}: ${profileError.message}`);

  await insertBatched(
    admin,
    'user_equipment',
    archetype.equipment
      .filter((e) => tagBySlug.has(e.slug))
      .map((e) => ({
        user_id: userId,
        equipment_tag_id: tagBySlug.get(e.slug)!,
        max_load_kg: e.maxLoadKg ?? null,
      })),
    `user_equipment for ${archetype.key}`
  );

  const history = generateHistory(archetype, endDate, mulberry32(SEED));

  const { data: workouts, error: workoutError } = await admin
    .from('workouts')
    .insert(
      history.map((w) => ({
        user_id: userId,
        local_date: w.localDate,
        status: w.status,
        notes: w.notes,
        started_at: w.status === 'completed' ? `${w.localDate}T17:00:00Z` : null,
        ended_at: w.status === 'completed' ? `${w.localDate}T18:15:00Z` : null,
      }))
    )
    .select('id, local_date');
  if (workoutError) throw new Error(`workouts for ${archetype.key}: ${workoutError.message}`);

  // A user can have several sessions on one date, so match by position rather
  // than by date: insert order is preserved in the returned rows.
  const rows: Record<string, unknown>[] = [];
  history.forEach((workout, index) => {
    const workoutId = workouts![index]!.id;
    for (const set of workout.sets) {
      const exerciseId = exerciseBySlug.get(set.exerciseSlug);
      if (!exerciseId) continue;
      rows.push({
        user_id: userId,
        workout_id: workoutId,
        exercise_id: exerciseId,
        set_index: set.setIndex,
        weight_kg: set.weightKg,
        reps: set.reps,
        rpe: set.rpe,
        rest_seconds: set.restSeconds,
        is_warmup: set.isWarmup,
        completed_at: `${workout.localDate}T17:30:00Z`,
      });
    }
  });

  await insertBatched(admin, 'sets', rows, `sets for ${archetype.key}`);

  /*
   * One accepted plan per user, so /coach has something to render.
   *
   * WHY a stub block rather than a generated one: generating needs a key, and
   * the demo has to work without one. This is the same compliantBlock the
   * golden suite uses, so it satisfies all six rules in src/planner/rules.ts by
   * construction — the row is marked accepted because it genuinely passes them,
   * not as a shortcut.
   *
   * AI-NOTE: if compliantBlock ever stops satisfying the rules, the golden
   *          suite fails first and loudly, before this row is ever written.
   */
  const { ruleContext } = buildPlannerContext({
    goal: 'strength',
    daysPerWeek: archetype.daysPerWeek,
    blockWeeks: PLAN_WEEKS,
    injuredJoints: [],
    asOf: endDate,
    workouts: history.map((w, i) => ({
      id: `seed-${i}`,
      localDate: w.localDate,
      status: w.status,
    })),
    sets: history.flatMap((w) =>
      w.sets.map((set) => ({
        exerciseId: `ex-${set.exerciseSlug}`,
        weightKg: set.weightKg,
        reps: set.reps,
        rpe: set.rpe,
        isWarmup: set.isWarmup,
        localDate: w.localDate,
      }))
    ),
    candidates: plausibleFirst(candidatesFor(archetype)),
  });

  const { error: planError } = await admin.from('plan_runs').insert({
    user_id: userId,
    status: 'accepted',
    iterations: 1,
    block: compliantBlock(ruleContext, PLAN_WEEKS, archetype.daysPerWeek) as never,
    rejections: [],
    input_hash: 'seeded',
  });
  if (planError) throw new Error(`plan_run for ${archetype.key}: ${planError.message}`);

  return { workouts: history.length, sets: rows.length };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const admin = adminClient();
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Snapshot;

  // WHY a fixed end date is not used: the demo should always look recent. The
  // history is generated relative to today, so a seed run months from now still
  // produces a user who trained last week.
  const endDate = new Date().toISOString().slice(0, 10);

  console.log('Clearing previous seed data');
  await clean(admin);

  console.log(`Seeding catalogue (${snapshot.license})`);
  const exerciseBySlug = await seedCatalogue(admin, snapshot);

  const { data: tags } = await admin.from('equipment_tags').select('id, slug').is('user_id', null);
  const tagBySlug = new Map((tags ?? []).map((t) => [t.slug, t.id]));

  console.log('Seeding synthetic users');
  for (const archetype of ARCHETYPES) {
    const { workouts, sets } = await seedArchetype(
      admin,
      archetype,
      exerciseBySlug,
      endDate,
      tagBySlug
    );
    console.log(`  ${archetype.key.padEnd(13)} ${workouts} workouts, ${sets} sets`);
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nSeeded in ${seconds}s. Sign in as any @samson.test address.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
