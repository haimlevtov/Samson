/**
 * The Supabase-backed PlanRunStore.
 *
 * WHY this is the only implementation that touches Postgres: the planner loop
 * depends on the `PlanRunStore` interface instead, so the unit suite proves the
 * evaluator-optimizer's behaviour with no database at all — the same discipline
 * `src/db/ledger.ts` applies to the token ledger.
 *
 * INVARIANT: RLS is on and the row carries user_id — CLAUDE.md #10. This writes
 *            through a request-scoped client, never the service role.
 */
import type { Db } from './client';
import type { PlanRunInsert, PlanRunStore } from '../planner/types';
import type { Json } from './types';

export function createSupabasePlanStore(db: Db): PlanRunStore {
  return {
    async insertPlanRun(row: PlanRunInsert): Promise<void> {
      const { error } = await db.from('plan_runs').insert({
        user_id: row.user_id,
        status: row.status,
        iterations: row.iterations,
        // The generated column type is Json. TrainingBlock and Rejection are
        // JSON-shaped by construction — every field is a string, number,
        // boolean, array or plain object — so this cast asserts what the Zod
        // schemas have already validated.
        block: (row.block ?? null) as unknown as Json,
        rejections: row.rejections as unknown as Json,
        input_hash: row.input_hash,
      });

      if (error) {
        // WHY thrown rather than logged: a run whose outcome went unrecorded is
        // a gap in exactly the measurement this table exists to produce. The
        // same reasoning as the ledger write in the gateway.
        throw new Error(`plan_runs insert failed: ${error.message}`);
      }
    },
  };
}

/**
 * Seconds a plan run is treated as still in flight — rework PR 8b.
 *
 * Slightly above `app/coach/page.tsx`'s `maxDuration`, so a run the platform is
 * still executing always counts as recent. Below that and a second press could
 * slip in while the first is mid-generation, which is the case this exists for.
 */
export const PLAN_RUN_COOLDOWN_SECONDS = 75;

/**
 * Whether this user started a plan run in the last `PLAN_RUN_COOLDOWN_SECONDS`.
 *
 * FOUND IN REVIEW of PR 8b, and it is the finding with money attached. The only
 * thing stopping a second press was `disabled={pending}` on the button, which is
 * client state — the server action is a plain endpoint. An authenticated user
 * (or a second tab, or an impatient double-click) could start N concurrent runs,
 * and `enforceBudget` reads spend and then allows, so all N read the same stale
 * trailing figure and all N pass. The chat stage made that worth 400 tokens a
 * press; the planner makes it 6,000, at roughly $0.05 a planner call — measured $0.047 after the candidate-limit cut — against a $0.50
 * weekly ceiling.
 *
 * WHY a recency read rather than a lock or a queue: CLAUDE.md puts queues out of
 * scope, and this is one RLS-scoped indexed read on a table the run is about to
 * write anyway. It does not make concurrency impossible — two requests inside
 * the same millisecond still race — it makes the cheap, repeatable version of
 * the attack stop working, which is the one a bored user performs by accident.
 *
 * INVARIANT: scoped by RLS to the caller's own rows. `plan_runs` has read-own
 *            and insert-own policies and no service role is involved.
 */
export async function startedPlanRunRecently(db: Db, seconds: number): Promise<boolean> {
  const since = new Date(Date.now() - seconds * 1000).toISOString();

  const { data, error } = await db.from('plan_runs').select('id').gte('created_at', since).limit(1);

  // Thrown, not swallowed into `false`: a read that failed says nothing about
  // whether a run is in flight, and guessing "no" is the guess that spends.
  if (error) throw new Error(`plan_runs recency check failed: ${error.message}`);

  return (data ?? []).length > 0;
}

/**
 * How long after a mid-session question before the next one — ADR 0031.
 *
 * Shorter than `PLAN_RUN_COOLDOWN_SECONDS` because the two protect different
 * things: a plan run is a minute of work somebody pressed a button for, and this
 * is a question asked between sets, where a wait longer than the rest itself
 * makes the feature useless. Long enough that a scripted loop is not free.
 */
export const SESSION_COACH_COOLDOWN_SECONDS = 8;

/**
 * Whether this user spoke to the coach within the window.
 *
 * INVARIANT: RLS scopes the read to the caller — CLAUDE.md #10. `llm_calls` is
 *            own-row, so this counts nobody else's questions.
 *
 * FOUND IN REVIEW of ADR 0031: that action is the most expensive in the app —
 * up to six chat calls plus two speech attempts per press — and it shipped
 * without the guard `startedPlanRunRecently` already gives its cheaper sibling.
 * `disabled={pending}` is client state on one tab and stops nobody scripting a
 * POST, and the budget gate reads spend before it allows, so concurrent presses
 * all pass on one stale figure.
 *
 * Thrown rather than swallowed into `false`, for the same reason as the sibling:
 * a read that failed says nothing about whether a call is in flight, and
 * guessing "no" is the guess that spends.
 *
 * AI-NOTE: read-then-act, so two requests in the same instant still race — the
 *          caveat `startedPlanRunRecently` carries and which an earlier draft of
 *          this comment dropped while claiming a scripted loop is not free. It
 *          raises the cost of a loop; what BOUNDS the damage is the per-user
 *          weekly budget, and that gate has an unreserved gap of its own
 *          (ADR 0025). Do not describe this as a rate limit.
 *
 * AI-NOTE: a `budget_denied` row is a `chat` row too — CLAUDE.md #3 — so once
 *          the week is spent, the first press writes one and the next few
 *          seconds of presses say "one question at a time" instead of the budget
 *          sentence the card has a state for. Cosmetic, and it hides the only
 *          actionable message; worth filtering on `status` if it ever annoys
 *          somebody.
 */
/**
 * How close together two voice previews may be.
 *
 * Shorter than `SESSION_COACH_COOLDOWN_SECONDS` because this guards ONE speech
 * attempt rather than up to six chat calls plus two — and because the control it
 * sits behind is a row of six buttons somebody is meant to compare. A window
 * that made comparing them feel broken would be a guard the product pays for.
 */
export const COACH_VOICE_COOLDOWN_SECONDS = 3;

/**
 * Whether this user asked for a spoken line within the window.
 *
 * INVARIANT: RLS scopes the read to the caller — CLAUDE.md #10. `llm_calls` is
 *            own-row, so this counts nobody else's presses.
 *
 * FOUND IN REVIEW of rework PR 5. `hearCoach` was the only paid action in the
 * app without this guard, and that was survivable while its one button lived
 * behind an accepted plan on the Coach tab. That PR put SIX of them on the
 * onboarding coach step — which is where `/sign-in`'s credential-free demo
 * button lands you, since the fixture's password is printed on the page. Each
 * press is `SPEECH_ASSUMED_COST_USD` against a $0.50 week shared with the
 * planner and the chat, so a scripted loop silences the demo account for the
 * rest of the window: an availability problem on the account the demo runs on.
 *
 * Thrown rather than swallowed into `false`, like its siblings: a read that
 * failed says nothing about whether a call is in flight, and guessing "no" is
 * the guess that spends.
 *
 * AI-NOTE: read-then-act, so two requests in the same instant still race — the
 *          caveat both siblings carry. It raises the cost of a loop; what
 *          BOUNDS the damage is the weekly budget, which has an unreserved gap
 *          of its own (ADR 0026 §4). Do not describe this as a rate limit.
 *
 * AI-NOTE: filtered to `stage = 'speech'` deliberately. Without it every chat
 *          question would silence the Try button, and a preview would silence
 *          the chat — two features taking each other's cooldown.
 *
 *          SINCE REWORK PR 6 THAT IS ONLY HALF TRUE, and it is said here rather
 *          than left: a SPOKEN chat reply writes a `speech` row, so on the Coach
 *          tab it does silence Try — and a preview silences the next spoken
 *          reply — for `COACH_VOICE_COOLDOWN_SECONDS`. Deliberate: both are the
 *          same paid call, and a three-second window between two of them on
 *          one page is the point of the guard, not a side effect of it.
 */
export async function askedForAVoiceRecently(db: Db, seconds: number): Promise<boolean> {
  const since = new Date(Date.now() - seconds * 1000).toISOString();

  const { data, error } = await db
    .from('llm_calls')
    .select('id')
    .eq('stage', 'speech')
    .gte('created_at', since)
    .limit(1);

  if (error) throw new Error(`llm_calls recency check failed: ${error.message}`);

  return (data ?? []).length > 0;
}

export async function spokeToCoachRecently(db: Db, seconds: number): Promise<boolean> {
  const since = new Date(Date.now() - seconds * 1000).toISOString();

  const { data, error } = await db
    .from('llm_calls')
    .select('id')
    .eq('stage', 'chat')
    .gte('created_at', since)
    .limit(1);

  if (error) throw new Error(`llm_calls recency check failed: ${error.message}`);

  return (data ?? []).length > 0;
}
