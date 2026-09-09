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
import {
  ARCHETYPES,
  generateHistory,
  validateProgramme,
  type Archetype,
} from '../src/seed/archetypes';
import { mulberry32 } from '../src/seed/rng';
import { createAnonClient, createUserClient, supabaseUrl, type Db } from '../src/db/client';
import { buildPlannerContext } from '../src/planner/context';
import { candidatesFor } from '../tests/planner/golden';
import { compliantBlock } from '../tests/planner/stub-planner';
import type { Database } from '../src/db/types';

config({ path: '.env.local', quiet: true });

/** Fixed so the database is byte-identical on every run. */
const SEED = 42;

/** Shared by every archetype, and shown on the sign-in page — docs/FRAMING.md. */
const DEMO_PASSWORD = 'samson-demo-fixture';
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
  for (const user of seeded) {
    /*
     * FOUND IN REVIEW: this discarded the result. deleteUser RETURNS an error
     * rather than throwing, including for a retryable network failure, so a
     * failed delete was silent — and the run then walked into createUser for
     * the same address and failed with "email already exists", on this run and
     * every rerun after it, reporting the wrong cause.
     */
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw new Error(`deleting ${user.email}: ${deleteError.message}`);
  }

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
): Promise<{ workouts: number; sets: number; awarded: number; badges: number }> {
  const created = await admin.auth.admin.createUser({
    email: archetype.email,
    password: DEMO_PASSWORD,
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

  /*
   * History is written ONE SESSION AT A TIME, in date order, each kept day
   * awarded before the next day exists.
   *
   * WHY, and this is the whole reason the function is shaped like this rather
   * than two bulk inserts followed by an awarding pass: both of the things that
   * turn history into progress read "the database as it is now", with no as-of
   * bound.
   *
   *   * `award_session_xp` picks its point on the diminishing curve from
   *     `count(*)` of the week's kept days — 20260902110000. That count is
   *     correct when rows appear as they are lived, which is how `finishWorkout`
   *     writes them. Against a pre-loaded week it is already the week's FINAL
   *     size on the first call, so every session in the week is charged the
   *     last one's discount. MEASURED that way round: a seven-day week paid
   *     26 XP four times where `weeklyAwards` in src/gamification/xp.ts — the
   *     deterministic definition, invariant #1 — says 100, 80, 64, 51.
   *
   *   * `evaluate_achievements` tests each predicate against the whole history,
   *     so with everything pre-loaded EVERY badge a user will ever earn fires
   *     on the first call, stamped with the oldest session's date, and their
   *     75 XP each collide with that week's 500 ceiling. `achievement_events`
   *     is once-only, so the XP past the ceiling is never paid at all.
   *
   * The plan's justification for going through the RPC at all was "a demo
   * database whose numbers cannot be reproduced by using the app is worth very
   * little". Bulk-loading and then awarding produced exactly that, one layer up
   * from the shortcut it was avoiding.
   *
   * AI-NOTE: do not batch this back up. If it needs to be faster, make the
   *          round trips cheaper — the ORDER is the correctness property, not
   *          an implementation detail.
   */
  const user = await signInAs(archetype);
  let setCount = 0;
  let awarded = 0;
  const badges = new Set<string>();

  for (const [index, workout] of history.entries()) {
    const { data: row, error: workoutError } = await admin
      .from('workouts')
      .insert({
        user_id: userId,
        local_date: workout.localDate,
        status: workout.status,
        notes: workout.notes,
        started_at: workout.status === 'completed' ? `${workout.localDate}T17:00:00Z` : null,
        ended_at: workout.status === 'completed' ? `${workout.localDate}T18:15:00Z` : null,
      })
      .select('id')
      .single();
    if (workoutError || !row) {
      throw new Error(
        `workout ${index} (${workout.localDate}) for ${archetype.key}: ${workoutError?.message}`
      );
    }

    const rows = workout.sets.flatMap((set) => {
      const exerciseId = exerciseBySlug.get(set.exerciseSlug);
      /*
       * FOUND IN REVIEW: this used to `return []`, which is the same silent drop
       * the programme guard in src/seed/archetypes.ts exists to stop — one layer
       * down, and with a worse consequence. A slug missing from the catalogue
       * made its sets vanish; if every set in a session dropped, the workout was
       * still inserted as `completed` and still awarded XP — a finished session
       * with nothing in it. And tests/planner/golden.ts builds its exercise ids
       * from the slug with no lookup, so the golden fixture and the database
       * would describe different histories for the same person, which both files
       * say must never happen.
       *
       * Latent rather than live — every shipped slug is in the snapshot, and a
       * test now asserts that offline — but the snapshot is regenerable and
       * nothing else was checking.
       */
      if (!exerciseId) {
        throw new Error(
          `${archetype.key}: ${set.exerciseSlug} on ${workout.localDate} is not in the ` +
            'exercise catalogue, so its sets would silently vanish'
        );
      }
      return [
        {
          user_id: userId,
          workout_id: row.id,
          exercise_id: exerciseId,
          set_index: set.setIndex,
          weight_kg: set.weightKg,
          reps: set.reps,
          rpe: set.rpe,
          rest_seconds: set.restSeconds,
          is_warmup: set.isWarmup,
          completed_at: `${workout.localDate}T17:30:00Z`,
        },
      ];
    });

    if (rows.length > 0) {
      const { error } = await admin.from('sets').insert(rows as never);
      if (error) {
        throw new Error(`sets for ${archetype.key} on ${workout.localDate}: ${error.message}`);
      }
      setCount += rows.length;
    }

    // INVARIANT: a rest day earns what a training day earns — CLAUDE.md #4,
    //            migration 20260902100000. The RPC accepts both statuses; a
    //            pass that awarded only 'completed' would leave most of each
    //            week's kept days unpaid while they still moved the curve.
    if (workout.status !== 'completed' && workout.status !== 'rest') continue;

    const result = await awardSession(user, archetype, row.id, workout.localDate);
    awarded += result.awarded;
    for (const slug of result.unlocked) badges.add(slug);
  }

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

  return { workouts: history.length, sets: setCount, awarded, badges: badges.size };
}

/**
 * Retries a hosted round trip a couple of times before giving up.
 *
 * WHY a seed script has retries at all: a run is ~230 round trips per archetype
 * and a single transient failure discards the whole database. Two real ones
 * have been seen from this project — "JWT issued at future" from a few seconds
 * of clock skew, and the password grant's per-IP rate limit while iterating.
 * Both clear on their own within a second or two.
 *
 * INVARIANT: only wrap calls that are idempotent. `award_session_xp` is, by
 *            construction rather than by convention —
 *            `xp_events_one_adherence_per_workout` (20260902095100),
 *            `xp_events_one_streak_per_workout` and `achievement_events_once`
 *            all refuse a second row for the same workout. So a retry after a
 *            lost response cannot double-award. Do not wrap a plain INSERT.
 */
async function withRetry<T>(label: string, attempt: () => Promise<T>): Promise<T> {
  const delays = [400, 1200];
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (error) {
      const delay = delays[i];
      if (delay === undefined) throw error;
      console.log(`  retrying ${label} after ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * A session bound to one archetype, for the awarding calls.
 *
 * WHY a real sign-in when the script already holds the service role:
 * `award_session_xp` filters on `auth.uid()` and takes no user parameter —
 * deliberately, per ADR 0009, so the caller does not get to say who they are.
 * The service role cannot stand in for a session, which is the invariant
 * working rather than an inconvenience.
 *
 * AI-NOTE: `autoRefreshToken: false` is not merely tidy. An auto-refresh timer
 *          keeps the Node event loop alive and the script would never exit —
 *          and `createUserClient` pins the token into a static Authorization
 *          header anyway, so a refreshed session would never reach the RPC. If
 *          a run ever outgrows the hour-long JWT, sign in again rather than
 *          flipping this flag.
 */
async function signInAs(archetype: Archetype): Promise<Db> {
  const anon = createAnonClient();

  return withRetry(`sign-in for ${archetype.key}`, async () => {
    const signIn = await anon.auth.signInWithPassword({
      email: archetype.email,
      password: DEMO_PASSWORD,
    });
    if (signIn.error || !signIn.data.session) {
      throw new Error(`signing in ${archetype.key}: ${signIn.error?.message ?? 'no session'}`);
    }
    return createUserClient(signIn.data.session.access_token);
  });
}

/**
 * One kept day, awarded the way `finishWorkout` awards it.
 *
 * INVARIANT: `award_session_xp` is the only path that writes XP — ADR 0009.
 *            This script holds the service role and could insert `xp_events`
 *            directly in one statement, saving several hundred round trips. It
 *            does not, and that is the point: XP inserted by hand is XP the
 *            rules did not produce, and a demo of a rules engine whose numbers
 *            cannot be reproduced by using the app is worth very little.
 */
async function awardSession(
  user: Db,
  archetype: Archetype,
  workoutId: string,
  localDate: string
): Promise<{ awarded: number; unlocked: string[] }> {
  return withRetry(`${archetype.key} ${localDate}`, async () => {
    const { data, error } = await user.rpc('award_session_xp', { p_workout_id: workoutId });
    if (error) {
      throw new Error(`awarding ${archetype.key} ${localDate} (${workoutId}): ${error.message}`);
    }
    const result = data as { awarded?: number; unlocked?: string[] } | null;
    return { awarded: result?.awarded ?? 0, unlocked: result?.unlocked ?? [] };
  });
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const admin = adminClient();
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Snapshot;

  // WHY a fixed end date is not used: the demo should always look recent. The
  // history is generated relative to today, so a seed run months from now still
  // produces a user who trained last week.
  const endDate = new Date().toISOString().slice(0, 10);

  /*
   * Every programme is validated BEFORE anything is deleted or written.
   *
   * FOUND IN REVIEW: `generateHistory` validates too, but it is called after the
   * auth user, the profile and the equipment rows for that archetype already
   * exist — so a typo left three writes behind for the failing user while the
   * other four seeded on. `clean()` recovers on the next run, so nothing was
   * broken; but the check needs no database at all, and up here it reports EVERY
   * bad archetype at once rather than whichever one happened to get there first.
   */
  for (const archetype of ARCHETYPES) validateProgramme(archetype);

  console.log('Clearing previous seed data');
  await clean(admin);

  console.log(`Seeding catalogue (${snapshot.license})`);
  const exerciseBySlug = await seedCatalogue(admin, snapshot);

  const { data: tags } = await admin.from('equipment_tags').select('id, slug').is('user_id', null);
  const tagBySlug = new Map((tags ?? []).map((t) => [t.slug, t.id]));

  /*
   * WHY the users run in parallel and their own sessions do not: order matters
   * WITHIN a user, because every session's award depends on the week that
   * exists when it is made — see the comment in `seedArchetype`. It does not
   * matter BETWEEN users: the ceiling is per user per week, and migration
   * 20260902110000 takes an advisory lock on exactly that pair, so two users
   * can never contend.
   *
   * This is also what keeps the pass inside PLAN.md phase 1's 60-second seed
   * budget, which CI enforces against a local stack. Five sequential passes
   * would be five times the latency for no extra correctness.
   */
  console.log('Seeding synthetic users, one session at a time');
  const results = await Promise.allSettled(
    ARCHETYPES.map(async (archetype) => ({
      archetype,
      ...(await seedArchetype(admin, archetype, exerciseBySlug, endDate, tagBySlug)),
    }))
  );

  /*
   * allSettled rather than all, so a failure names every user that failed
   * instead of only whichever rejected first. `clean()` makes a rerun recover —
   * deleting the auth user cascades the partial XP away — but only if the
   * operator can see which users to look at.
   */
  const failures = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []));
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { archetype, workouts, sets, awarded, badges } = result.value;
    console.log(
      `  ${archetype.key.padEnd(13)} ${workouts} workouts, ${String(sets).padStart(3)} sets, ` +
        `${String(awarded).padStart(5)} XP, ${badges} badge(s)`
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} archetype(s) failed:\n` +
        failures.map((f) => `  ${f instanceof Error ? f.message : String(f)}`).join('\n')
    );
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nSeeded in ${seconds}s. Sign in as any @samson.test address.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
