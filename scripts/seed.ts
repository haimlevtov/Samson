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
  PLANLESS_ARCHETYPE,
  generateHistory,
  outOfGrant,
  templatesFor,
  toTemplateDraft,
  validateProgramme,
  type Archetype,
  type EquipmentOf,
  type GeneratedWorkout,
  FRESH_ACCOUNT,
} from '../src/seed/archetypes';
import { createTemplate } from '../src/db/templates';
import { assignFromPool, type PoolTemplate } from '../src/gamification/assignment';
import { localDateIn } from '../src/metrics/dates';
import type { ChallengeContext } from '../src/gamification/challenge';
import { mulberry32 } from '../src/seed/rng';
import { createAnonClient, createUserClient, supabaseUrl, type Db } from '../src/db/client';
import { buildPlannerContext } from '../src/planner/context';
import { candidatesFor } from '../tests/planner/golden';
import { compliantBlock } from '../tests/planner/stub-planner';
import type { Database, Json } from '../src/db/types';

config({ path: '.env.local', quiet: true });

/** Fixed so the database is byte-identical on every run. */
const SEED = 42;

/** The `app_metadata` key every account this script creates carries — see `clean()`. */
const FIXTURE_MARK = 'fixture';

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

  /*
   * By address, and by the fixture mark — ADR 0026's 2026-09-13 amendment.
   *
   * WHY the mark: every fixture's password is published, so a session holding
   * one may change the account's address (the auth settings make it hard, not
   * impossible). By address alone this would miss the renamed account, leave it
   * under its new address with whatever it held — the $2.00 ceiling included —
   * and create a second copy beside it. `app_metadata` is writable only by the
   * service role, so a session cannot remove the mark. Accounts seeded before
   * it existed are still caught by address, as before.
   */
  const seeded = data.users.filter(
    (u) => u.email?.endsWith('@samson.test') || u.app_metadata?.[FIXTURE_MARK] !== undefined
  );
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
  tagBySlug: Map<string, string>,
  pool: readonly PoolTemplate[],
  equipmentOf: EquipmentOf
): Promise<{
  workouts: number;
  sets: number;
  awarded: number;
  badges: number;
  offered: number;
  rejected: number;
  accepted: number;
  templates: number;
  excluded: string[];
}> {
  const created = await admin.auth.admin.createUser({
    email: archetype.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    // What `clean()` finds a fixture by when its address has changed — see there.
    app_metadata: { [FIXTURE_MARK]: archetype.key },
  });
  if (created.error || !created.data.user) {
    throw new Error(`creating ${archetype.email}: ${created.error?.message}`);
  }
  const userId = created.data.user.id;

  const { error: profileError } = await admin.from('users').insert({
    user_id: userId,
    display_name: archetype.displayName,
    /*
     * Already onboarded — ADR 0032 §2. Without this the five furnished demo
     * users are sent to `/welcome` on their next sign-in and asked questions
     * they have twelve weeks of answers to. FOUND IN REVIEW.
     */
    onboarded_at: new Date().toISOString(),
    diet_goal: 'maintain',
    // INVARIANT: UTC plus the user's IANA timezone — CLAUDE.md #9. Each
    // archetype lives somewhere different so calendar logic gets exercised.
    timezone: archetype.timezone,
    unit_preference: 'metric',
    // The diet advisor's four inputs — ADR 0024. Optional in the product; set
    // here because a demo whose diet block asks for a height is not a demo.
    bodyweight_kg: archetype.bodyweightKg,
    height_cm: archetype.heightCm,
    birth_date: archetype.birthDate,
    sex: archetype.sex,
    // ADR 0026's amendment. The only service-role writer of the ceiling in
    // application scripts; migration 20260913090000 set the row that already
    // existed on hosted — see the AI-NOTE on EVALUATOR_WEEKLY_BUDGET_USD.
    // Absent, the column's default applies.
    ...(archetype.weeklyBudgetUsd === undefined
      ? {}
      : { llm_weekly_budget_usd: archetype.weeklyBudgetUsd }),
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

  /*
   * ONE ARCHETYPE SHIPS WITH NO PLAN — the rework plan asks for it, so that the
   * Coach tab's empty state and its questionnaire (rework PR 8b, ADR 0027) are
   * reachable without deleting a row by hand.
   *
   * The inconsistent archetype is the one it should be, and the reason is the
   * character rather than convenience: somebody who misses half their sessions
   * is the likeliest of the five not to have got round to asking for a plan. It
   * also means the state is exercised by the user whose history is thinnest,
   * which is the harder case for the planner when they do ask.
   *
   * AI-NOTE: four accepted rows, not five. A test or a demo script that assumes
   *          every seeded user has a plan will be wrong about exactly this one.
   */
  if (archetype.key === PLANLESS_ARCHETYPE) {
    console.log(`  plan_runs: none for ${archetype.key}, deliberately`);
  } else {
    const { error: planError } = await admin.from('plan_runs').insert({
      user_id: userId,
      status: 'accepted',
      iterations: 1,
      block: compliantBlock(ruleContext, PLAN_WEEKS, archetype.daysPerWeek) as never,
      rejections: [],
      input_hash: 'seeded',
    });
    if (planError) throw new Error(`plan_run for ${archetype.key}: ${planError.message}`);
  }

  const challenges = await seedChallenges({
    admin,
    user,
    archetype,
    userId,
    history,
    exerciseBySlug,
    pool,
  });

  /*
   * The Workout tab's templates — one per session of the rotation, built by
   * `templatesFor` from the programme at the most recent logged loads, leaving
   * out any lift the archetype's equipment does not allow.
   *
   * Written through `createTemplate` as the signed-in archetype rather than
   * with the service role, the same discipline `awardSession` and the
   * challenge acceptance follow: its Zod parse and its compensating delete are
   * the app's, and a seeded row the app itself could not have written is worth
   * very little.
   *
   * AI-NOTE: not wrapped in `withRetry`. createTemplate is two plain inserts,
   *          and that function's INVARIANT is to wrap only idempotent calls — a
   *          retry after a lost response would write a second "Day A".
   */
  const drafts = templatesFor(archetype, history, equipmentOf);
  for (const draft of drafts) {
    // toTemplateDraft is the same mapping src/seed/archetypes.test.ts parses,
    // and it fails loudly on a slug the catalogue lacks — see its doc comment.
    await createTemplate(
      user,
      userId,
      toTemplateDraft(draft, (slug) => exerciseBySlug.get(slug))
    );
  }

  return {
    workouts: history.length,
    sets: setCount,
    awarded,
    badges: badges.size,
    ...challenges,
    templates: drafts.length,
    excluded: outOfGrant(archetype, equipmentOf),
  };
}

interface ChallengeSeed {
  admin: Admin;
  user: Db;
  archetype: Archetype;
  userId: string;
  history: readonly GeneratedWorkout[];
  exerciseBySlug: Map<string, string>;
  pool: readonly PoolTemplate[];
}

/**
 * The Hub's three buckets, for one archetype.
 *
 * WHY this exists at all: the batch that assigns challenges is a GitHub Actions
 * cron, and `npm run seed` has never called it — so every demo user opened a Hub
 * with three empty lists. Nothing was broken; nothing had ever created a row.
 *
 * INVARIANT: the DECISION is `assignFromPool`, the same function
 *            scripts/generate-challenges.ts uses, so the demo database and the
 *            cron cannot disagree about what a given history is offered. The
 *            INPUTS still differ — this passes an empty `alreadyAssigned`
 *            because a freshly seeded user owns nothing — so sharing the
 *            function narrows the drift rather than eliminating it.
 */
async function seedChallenges({
  admin,
  user,
  archetype,
  userId,
  history,
  exerciseBySlug,
  pool,
}: ChallengeSeed): Promise<{ offered: number; rejected: number; accepted: number }> {
  /*
   * The same context the cron builds, from memory rather than from a re-read.
   *
   * INVARIANT: the window is written from the USER'S local date, never the
   *            server's — CLAUDE.md #9, and `accept_challenge` compares
   *            `window_end` against exactly this. FOUND IN REVIEW: this used
   *            `endDate`, a UTC date. West of UTC that made a challenge
   *            acceptable through the whole of the user's previous local day;
   *            east of it, after 21:00 UTC, every daily row's window was
   *            already closed when it was written.
   *
   * The history was generated to end on `endDate`, so for a zone ahead of UTC
   * this window can include one day the seeded history does not cover. That
   * lowers measured progress slightly, which can only make a challenge MORE
   * likely to be offered — never less, and never wrongly rejected.
   */
  const asOf = localDateIn(archetype.timezone);
  const sets = history.flatMap((workout) =>
    workout.sets.map((set) => ({
      /*
       * Real catalogue ids, not slugs: `availableExerciseIds` is what bounds a
       * distinct_exercises target, and it has to be the same list the cron
       * would derive from this user's rows.
       *
       * The assertion is safe because the sets loop above THROWS on a slug the
       * catalogue does not have, so this runs only for a history every slug of
       * which resolved.
       */
      exerciseId: exerciseBySlug.get(set.exerciseSlug)!,
      weightKg: set.weightKg,
      reps: set.reps,
      rpe: set.rpe,
      isWarmup: set.isWarmup,
      localDate: workout.localDate,
    }))
  );
  const context: ChallengeContext = {
    workouts: history.map((workout, i) => ({
      id: `seed-${i}`,
      localDate: workout.localDate,
      status: workout.status,
    })),
    sets,
    // Plausibility judges a set against the user's own record, and at
    // assignment time there is no "new" set to hold apart — same as the cron.
    history: sets,
    asOf,
    availableExerciseIds: [...new Set(sets.map((set) => set.exerciseId))],
  };

  const { assignments } = assignFromPool(pool, context, []);

  const rows = assignments.map((row) => ({
    user_id: userId,
    slug: row.slug,
    kind: row.kind,
    status: row.status,
    window_start: row.windowStart,
    window_end: row.windowEnd,
    /*
     * The generated `Json` type takes an index-signature shape rather than an
     * interface with named fields, so these two need a cast and the rest of the
     * row does not.
     *
     * FOUND IN REVIEW: the insert used to cast the WHOLE payload with
     * `as never`, which turned off type checking on the one service-role write
     * that creates rows RLS forbids the app to create — including on
     * `user_id`. Narrow casts keep that field checked.
     */
    spec: row.spec as unknown as Json,
    validation_reasons: row.reasons.map((r) => ({ code: r.code, detail: r.detail })) as Json,
  }));
  /*
   * A direct insert rather than `insertBatched`, because the ids come back and
   * the acceptance below needs one. The pool is a dozen rows, so there is
   * nothing to batch.
   */
  const { data: written, error: writeErr } = await admin
    .from('challenges')
    .insert(rows)
    .select('id, slug');
  if (writeErr) throw new Error(`challenges for ${archetype.key}: ${writeErr.message}`);

  const offered = assignments.filter((row) => row.status === 'offered');
  const rejected = assignments.length - offered.length;

  /*
   * One challenge is put in play, and it is ACCEPTED rather than inserted as
   * 'active' — the same discipline `awardSession` follows for XP. An 'active'
   * row written by hand is a state the app itself cannot produce, and the
   * accept path is what phase 5 shipped.
   *
   * WHY a weekly one, now that the window is written from the user's own date
   * and a daily row would be accepted too: a daily window is the single day the
   * seeder ran, so it survives a midnight crossing between this insert and the
   * RPC call a moment later by nothing at all, where a weekly one has six days
   * of slack. It is also the better demo — the Hub shows partial progress from
   * history the user already has, where a daily quest on a rest day shows zero.
   */
  let accepted = 0;
  const toAccept = offered.find((row) => row.kind === 'weekly') ?? offered[0];
  if (toAccept) {
    const id = (written ?? []).find((row) => row.slug === toAccept.slug)?.id;
    if (id === undefined) {
      throw new Error(
        `${archetype.key}: ${toAccept.slug} was inserted but came back without an id`
      );
    }

    const { data: inPlay, error: acceptErr } = await user.rpc('accept_challenge', {
      p_challenge_id: id,
    });
    if (acceptErr) {
      throw new Error(`accepting ${toAccept.slug} for ${archetype.key}: ${acceptErr.message}`);
    }
    /*
     * The RPC returns false rather than erroring when it matched no row —
     * wrong owner, wrong status, or a closed window. Silence here would seed a
     * user whose Hub has nothing in play and no sign of why.
     */
    if (inPlay !== true) {
      throw new Error(
        `accepting ${toAccept.slug} for ${archetype.key}: the RPC matched no row ` +
          `(window ${toAccept.windowStart}..${toAccept.windowEnd}, timezone ${archetype.timezone})`
      );
    }
    accepted = 1;
  }

  return { offered: offered.length - accepted, rejected, accepted };
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
  // The equipment tag each lift carries — what the app filters on, and so what
  // a seeded template has to respect (outOfGrant, CLAUDE.md #5).
  const equipmentOf: EquipmentOf = new Map(snapshot.exercises.map((e) => [e.slug, e.equipment]));

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
  /*
   * The unassigned pool — `challenges` rows with a null user_id, shipped by
   * migration because content lives in the database (CLAUDE.md #7).
   *
   * Read ONCE and ordered by slug: the archetypes seed in parallel, and the
   * order decides which challenge each one accepts. Without the order the demo
   * database would differ run to run, against this file's own promise that a
   * fixed seed makes it byte-identical.
   */
  const { data: poolRows, error: poolError } = await admin
    .from('challenges')
    .select('slug, kind, spec')
    .is('user_id', null)
    .order('slug');
  if (poolError) throw new Error(`reading the challenge pool: ${poolError.message}`);
  const pool: PoolTemplate[] = (poolRows ?? []).map((row) => ({
    slug: row.slug,
    kind: row.kind as PoolTemplate['kind'],
    spec: row.spec,
  }));
  if (pool.length === 0) {
    throw new Error('the challenge pool is empty — have the migrations been applied?');
  }

  /*
   * The empty account — ADR 0032 §1. Created before the furnished five so that
   * a failure here is loud rather than buried under five parallel successes.
   *
   * INVARIANT: an auth user and NOTHING else. No `users` row is written, which
   *            is the whole fixture: it is what makes `/welcome` ask the first
   *            question, and what proves the app renders for somebody the
   *            profile table has never heard of.
   */
  console.log(`Seeding the empty account (${FRESH_ACCOUNT.email})`);
  const fresh = await admin.auth.admin.createUser({
    email: FRESH_ACCOUNT.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    /*
     * The reset gate — ADR 0032 §4, and migration 20260912200000 for why it is
     * THIS column. `app_metadata` is writable only by the service role: the
     * client SDK's `updateUser` writes `user_metadata`, a different column, and
     * no anon or authenticated session can reach this one.
     *
     * It used to be the email address, which a signed-up user chooses — so
     * anybody could claim `fresh@samson.test` and call a `security definer`
     * function that deletes gamification rows the client may not write.
     */
    app_metadata: { demo_reset: true, [FIXTURE_MARK]: FRESH_ACCOUNT.key },
  });
  if (fresh.error || !fresh.data.user) {
    throw new Error(`creating ${FRESH_ACCOUNT.email}: ${fresh.error?.message}`);
  }

  console.log('Seeding synthetic users, one session at a time');
  const results = await Promise.allSettled(
    ARCHETYPES.map(async (archetype) => ({
      archetype,
      ...(await seedArchetype(
        admin,
        archetype,
        exerciseBySlug,
        endDate,
        tagBySlug,
        pool,
        equipmentOf
      )),
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
    const {
      archetype,
      workouts,
      sets,
      awarded,
      badges,
      offered,
      rejected,
      accepted,
      templates,
      excluded,
    } = result.value;
    console.log(
      `  ${archetype.key.padEnd(13)} ${workouts} workouts, ${String(sets).padStart(3)} sets, ` +
        `${String(awarded).padStart(5)} XP, ${badges} badge(s), ` +
        `${offered} offered / ${accepted} active / ${rejected} rejected, ${templates} templates` +
        (excluded.length > 0 ? ` (left out, not in grant: ${excluded.join(', ')})` : '')
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
