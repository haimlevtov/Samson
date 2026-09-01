/**
 * The golden-set evaluation harness.
 *
 *   npm run eval:planner            offline, no key, no database, no money
 *   npm run eval:planner -- --live  real models against the seeded database
 *
 * WHAT OFFLINE MODE PROVES: the loop's machinery — thirty real histories build
 * valid planner inputs, the six rules are jointly satisfiable for every one of
 * them, and the loop reaches `accepted` within the retry cap. It runs the same
 * assertions `npm test` does, in a form that prints a table rather than a pass
 * count.
 *
 * WHAT IT DOES NOT PROVE: that a model writes good training. The stub planner
 * satisfies the rules by construction. Quoting an offline run as evidence of
 * planner quality would be verification theatre, which PLAN.md names as a thing
 * not to do. Only `--live` measures a model, and only `--live` produces the cost
 * and cache-hit figures phase 2's last two acceptance criteria ask for.
 */
import { config } from 'dotenv';
import { MissingApiKeyError, readApiKey } from '../src/llm/config';
import { callLLM, createGatewayDeps } from '../src/llm/gateway';
import { createSupabaseLedger } from '../src/db/ledger';
import { createSupabasePlanStore } from '../src/db/plans';
import { createUserClient, supabaseAnonKey, supabaseUrl } from '../src/db/client';
import { availableExercises } from '../src/db/exercises';
import { loadHistory } from '../src/db/training';
import { buildPlannerContext, type ContextCandidate } from '../src/planner/context';
import { generatePlan, type PlanRunResult } from '../src/planner/loop';
import type { CriticVerdict, TrainingBlock } from '../src/planner/schema';
import type { CallOptions, LlmResult } from '../src/llm/types';
import type { PlanRunStore } from '../src/planner/types';
import { goldenCases, GOLDEN_AS_OF, type GoldenCase } from '../tests/planner/golden';
import { compliantBlock, naiveBlock } from '../tests/planner/stub-planner';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/db/types';

config({ path: '.env.local', quiet: true });

const LIVE = process.argv.includes('--live');
/**
 * Offline, feed the loop a block that breaks every rule.
 *
 * WHY it earns a flag: a harness that only ever sees compliant plans reports
 * a column of zeroes and never exercises the half of the loop that rejects,
 * retries and escalates. This is how that half gets shown working.
 */
const NAIVE = process.argv.includes('--naive');
const SEED_PASSWORD = 'samson-demo-fixture';

// ---------------------------------------------------------------------------
// Offline: a stub planner that satisfies the rules by construction
// ---------------------------------------------------------------------------

function offlineDeps(block: TrainingBlock): { call: PlannerCall; plans: PlanRunStore } {
  const approved: CriticVerdict = { approved: true, reasons: [] };
  return {
    call: async <T>(options: CallOptions<T>): Promise<LlmResult<T>> => ({
      data: (options.stage === 'planner' ? block : approved) as T,
      modelUsed: `offline-${options.stage}`,
      attempts: 1,
      costCredits: 0,
      ledger: [],
    }),
    plans: { async insertPlanRun() {} },
  };
}

type PlannerCall = <T>(options: CallOptions<T>) => Promise<LlmResult<T>>;

// ---------------------------------------------------------------------------
// Live: real models, real database, real money
// ---------------------------------------------------------------------------

interface LiveSession {
  userId: string;
  call: PlannerCall;
  plans: PlanRunStore;
  candidates: ContextCandidate[];
  workouts: Awaited<ReturnType<typeof loadHistory>>['workouts'];
  sets: Awaited<ReturnType<typeof loadHistory>>['sets'];
  readLedger: () => Promise<{ cached: number; prompt: number; cost: number }>;
}

async function signIn(email: string): Promise<LiveSession> {
  const anon = createClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: SEED_PASSWORD,
  });
  if (error || !data.session) {
    throw new Error(
      `could not sign in ${email}: ${error?.message ?? 'no session'}. Run npm run seed.`
    );
  }

  const db = createUserClient(data.session.access_token);
  const userId = data.session.user.id;
  const gateway = createGatewayDeps(createSupabaseLedger(db));
  const history = await loadHistory(db);
  const candidates = (await availableExercises(db, userId)).map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    primaryMuscle: c.primaryMuscle,
    movementPattern: c.movementPattern,
    equipment: c.equipment,
  }));

  return {
    userId,
    call: <T>(options: CallOptions<T>) => callLLM(options, gateway),
    plans: createSupabasePlanStore(db),
    candidates,
    workouts: history.workouts,
    sets: history.sets,
    async readLedger() {
      const { data: rows, error: err } = await db
        .from('llm_calls')
        .select('prompt_tokens, cached_tokens, cost_credits')
        .eq('user_id', userId)
        .in('stage', ['planner', 'critic']);
      if (err) throw new Error(`reading the ledger: ${err.message}`);
      return (rows ?? []).reduce(
        (acc, r) => ({
          cached: acc.cached + (r.cached_tokens ?? 0),
          prompt: acc.prompt + (r.prompt_tokens ?? 0),
          cost: acc.cost + (r.cost_credits ?? 0),
        }),
        { cached: 0, prompt: 0, cost: 0 }
      );
    },
  };
}

// ---------------------------------------------------------------------------

interface Row {
  id: string;
  status: string;
  iterations: number;
  rules: number;
  critic: number;
  cost: number;
}

function toRow(golden: GoldenCase, result: PlanRunResult): Row {
  return {
    id: golden.id,
    status: result.status,
    iterations: result.iterations,
    rules: result.rejections.filter((r) => r.source === 'rules').length,
    critic: result.rejections.filter((r) => r.source === 'critic').length,
    cost: result.costCredits,
  };
}

function report(rows: Row[], live: boolean): void {
  const width = Math.max(...rows.map((r) => r.id.length), 4);
  console.log(
    `\n${'case'.padEnd(width)}  ${'status'.padEnd(16)} iters  rules  critic${live ? '     cost' : ''}`
  );
  console.log('-'.repeat(width + (live ? 48 : 38)));

  for (const row of rows) {
    console.log(
      `${row.id.padEnd(width)}  ${row.status.padEnd(16)} ${String(row.iterations).padStart(5)}  ${String(row.rules).padStart(5)}  ${String(row.critic).padStart(6)}${
        live ? `  ${row.cost.toFixed(5).padStart(8)}` : ''
      }`
    );
  }

  const accepted = rows.filter((r) => r.status === 'accepted').length;
  console.log(
    `\n${accepted}/${rows.length} accepted within the retry cap.` +
      ` Rules rejections: ${rows.reduce((n, r) => n + r.rules, 0)}.` +
      ` Critic rejections: ${rows.reduce((n, r) => n + r.critic, 0)}.`
  );
}

async function main(): Promise<void> {
  const cases = goldenCases();

  if (LIVE) {
    // The key check comes first: running this without one is the common case
    // and it should say so rather than failing on a Postgres connection.
    try {
      readApiKey();
    } catch (cause) {
      if (cause instanceof MissingApiKeyError) {
        console.error(`\n${cause.message}\n`);
        process.exit(1);
      }
      throw cause;
    }
    console.log('LIVE — real models, real spend. Ctrl-C now if that was not intended.\n');
  } else {
    console.log('OFFLINE — stub planner, no key, no spend.');
    console.log('This proves the machinery, not the model. Use --live to measure a model.\n');
  }

  const rows: Row[] = [];
  const sessions = new Map<string, LiveSession>();

  for (const golden of cases) {
    let context;
    let deps;

    if (LIVE) {
      let session = sessions.get(golden.archetype.email);
      if (session === undefined) {
        session = await signIn(golden.archetype.email);
        sessions.set(golden.archetype.email, session);
      }
      context = buildPlannerContext({
        goal: golden.goal,
        daysPerWeek: golden.daysPerWeek,
        blockWeeks: golden.blockWeeks,
        injuredJoints: golden.injuredJoints,
        asOf: GOLDEN_AS_OF,
        workouts: session.workouts,
        sets: session.sets,
        candidates: session.candidates,
      });
      deps = { call: session.call, plans: session.plans };
    } else {
      context = buildPlannerContext({
        goal: golden.goal,
        daysPerWeek: golden.daysPerWeek,
        blockWeeks: golden.blockWeeks,
        injuredJoints: golden.injuredJoints,
        asOf: GOLDEN_AS_OF,
        workouts: golden.workouts,
        sets: golden.sets,
        candidates: golden.candidates,
      });
      deps = offlineDeps(
        NAIVE
          ? naiveBlock(context.ruleContext, golden.blockWeeks, golden.daysPerWeek)
          : compliantBlock(context.ruleContext, golden.blockWeeks, golden.daysPerWeek)
      );
    }

    const userId = LIVE
      ? (sessions.get(golden.archetype.email)?.userId ?? 'unknown')
      : `offline-${golden.archetype.key}`;

    const result = await generatePlan(userId, context.plannerInput, context.ruleContext, deps);
    rows.push(toRow(golden, result));
    process.stdout.write('.');
  }

  console.log();
  report(rows, LIVE);

  if (LIVE) {
    // The last two acceptance criteria. INVARIANT: these come out of the
    // ledger, never out of a model — CLAUDE.md #1.
    let cached = 0;
    let prompt = 0;
    let cost = 0;
    for (const session of sessions.values()) {
      const totals = await session.readLedger();
      cached += totals.cached;
      prompt += totals.prompt;
      cost += totals.cost;
    }
    console.log(
      `\nCache hit rate: ${prompt === 0 ? 'n/a' : `${((cached / prompt) * 100).toFixed(1)}%`}` +
        ` (${cached} cached of ${prompt} prompt tokens)`
    );
    console.log(`Total spend: ${cost.toFixed(4)} USD across ${cases.length} runs.`);
  }

  // In --naive mode rejection IS the expected outcome, so the exit code inverts:
  // a block that breaks every rule and still gets accepted means a gate failed
  // open, which is the worst result this harness can produce.
  const accepted = rows.filter((r) => r.status === 'accepted');
  const rejected = rows.filter((r) => r.status !== 'accepted');

  if (NAIVE) {
    if (accepted.length > 0) {
      console.log(
        `\n${accepted.length} case(s) accepted a block that breaks every rule. A gate failed open.`
      );
      process.exit(1);
    }
    console.log('\nEvery non-compliant block was rejected, and none reached the critic.');
    return;
  }

  if (rejected.length > 0) {
    console.log(`\n${rejected.length} case(s) did not reach an accepted plan.`);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
