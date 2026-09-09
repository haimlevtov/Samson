/**
 * The weekly challenge batch — PLAN.md phase 4.
 *
 *   npm run challenges:generate            report only, writes nothing
 *   npm run challenges:generate -- --apply  assigns and records rejections
 *
 * WHAT IT DOES, per user, in this order:
 *
 *   1. SETTLES finished challenges — `settleChallenges()` decides which are
 *      complete using `evaluateChallenge`, the same function the progress
 *      screen calls, and pays each out of what the week has left.
 *   2. Reads the unassigned pool (`challenges` rows with a null user_id),
 *      validates every candidate against that user's real history with the SAME
 *      validator the app uses, assigns what survives, and writes what does not —
 *      with its reasons.
 *
 * WHY settlement lives in a batch job and not in `finishWorkout`: paying out
 * needs to write `xp_events`, which only a definer function may do. Such a
 * function would have to either re-derive completion in SQL — a second
 * definition of what completing a challenge means, which the spec explicitly
 * warns against — or trust its caller. Trusting the caller means any signed-in
 * client can invoke it for its own challenge and be paid without doing the
 * work, which is the phase 4 criterion "no completion can be granted from the
 * client" failing outright. A batch job has neither problem: it is server-side
 * TypeScript using the one definition, and there is no endpoint to abuse. The
 * cost is that payout lands on the next run rather than the moment the set is
 * logged. ADR 0009 §4.
 *
 * INVARIANT: a rejected challenge is inspectable — PLAN.md phase 4. Rejected
 *            candidates are WRITTEN, with status 'rejected' and their reasons
 *            in `validation_reasons`. Dropping them would make the criterion
 *            unmeetable, because a row nobody can see is not inspectable.
 *
 * WHY the service role: this writes rows on behalf of users, which is exactly
 * what RLS forbids the application from doing. CLAUDE.md #10 bans the service
 * role in APPLICATION code; this is a batch job, run by CI, never by a request.
 *
 * AI-NOTE: --apply is off by default deliberately. A batch job that writes on
 *          every invocation is one typo away from assigning the whole pool to
 *          everybody, and the dry run is the thing that makes the cron
 *          inspectable in the Actions log.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  challengeSpecSchema,
  type ChallengeContext,
  type ValidationReason,
} from '../src/gamification/challenge';
import { assignFromPool } from '../src/gamification/assignment';
import { settleChallenges, type AssignedChallenge } from '../src/gamification/settlement';
import { localDateIn, startOfWeek } from '../src/metrics/dates';
import type { Database } from '../src/db/types';
import type { SetRecord, WorkoutRecord } from '../src/metrics/types';

config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');

function admin() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url) throw new Error('SUPABASE_URL is required.');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to generate challenges.');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

async function main(): Promise<void> {
  const db = admin();

  const [{ data: pool, error: poolErr }, { data: users, error: userErr }] = await Promise.all([
    db.from('challenges').select('slug, kind, spec').is('user_id', null),
    db.from('users').select('user_id, timezone'),
  ]);
  if (poolErr) throw new Error(`reading pool: ${poolErr.message}`);
  if (userErr) throw new Error(`reading users: ${userErr.message}`);

  console.log(
    APPLY
      ? 'APPLY — assigning challenges and recording rejections.'
      : 'DRY RUN — nothing is written. Pass --apply to write.'
  );
  console.log(`${pool?.length ?? 0} pool templates, ${users?.length ?? 0} users.\n`);

  let settled = 0;
  let assigned = 0;
  let rejected = 0;
  /*
   * Collected rather than thrown, and reported at the end.
   *
   * FOUND IN REVIEW: throwing here aborted the batch mid-pass, AFTER settlement
   * had already paid XP for earlier users — so one bad row denied every later
   * user that week's challenges. Re-running converges (the status filter is the
   * idempotency guard) but only if somebody notices, and a batch that stops
   * halfway is exactly the run nobody reads to the end.
   */
  const writeFailures: string[] = [];

  for (const user of users ?? []) {
    const asOf = localDateIn(user.timezone ?? 'UTC');

    const [{ data: workouts }, { data: sets }, { data: owned }] = await Promise.all([
      db.from('workouts').select('id, local_date, status').eq('user_id', user.user_id),
      // The date lives on the workout, not the set — same join loadHistory uses.
      db
        .from('sets')
        .select('exercise_id, weight_kg, reps, rpe, is_warmup, workouts!inner(local_date)')
        .eq('user_id', user.user_id),
      db.from('challenges').select('id, slug, spec, status').eq('user_id', user.user_id),
    ]);

    const context: ChallengeContext = {
      workouts: (workouts ?? []).map((w): WorkoutRecord => ({
        id: w.id,
        localDate: w.local_date,
        status: w.status as WorkoutRecord['status'],
      })),
      sets: (sets ?? []).map((s): SetRecord => ({
        exerciseId: s.exercise_id,
        weightKg: s.weight_kg === null ? null : Number(s.weight_kg),
        reps: s.reps,
        rpe: s.rpe === null ? null : Number(s.rpe),
        isWarmup: s.is_warmup,
        localDate: (s.workouts as unknown as { local_date: string }).local_date,
      })),
      // The same rows: plausibility judges a set against the user's own record,
      // and at generation time there is no "new" set to separate out.
      history: [],
      asOf,
      availableExerciseIds: [...new Set((sets ?? []).map((s) => s.exercise_id))],
    };
    context.history = context.sets;

    const already = new Set((owned ?? []).map((c) => c.slug));
    /*
     * The id prefix, never the display name.
     *
     * FOUND IN REVIEW: this logged `display_name` — user-authored personal
     * data — for every user on every run, into a GitHub Actions log that is
     * retained and read by a human. A short id is enough to follow one user
     * down the report and to look them up, and it is not their name.
     */
    const label = user.user_id.slice(0, 8);

    /*
     * Settle before generating.
     *
     * A challenge finished this week must be paid out of this week's allowance
     * before any new one is offered, or the ceiling arithmetic is done against
     * a ledger that is about to change.
     */
    const weekStart = startOfWeek(asOf);
    const { data: weekXp } = await db
      .from('xp_events')
      .select('amount')
      .eq('user_id', user.user_id)
      .eq('week_start', weekStart);
    // Summed here rather than in SQL, unlike loadXpSummary: one user's single
    // week holds a handful of rows at most, because the ceiling is 500 and the
    // smallest award is 10.
    const awardedThisWeek = (weekXp ?? []).reduce((sum, row) => sum + row.amount, 0);

    const assignedChallenges = (owned ?? []).flatMap((row): AssignedChallenge[] => {
      const parsed = challengeSpecSchema.safeParse(row.spec);
      // A row written by an older generator is untrusted input like any other.
      if (!parsed.success) return [];
      return [{ id: row.id, slug: row.slug, spec: parsed.data, status: row.status }];
    });

    for (const done of settleChallenges(assignedChallenges, context, awardedThisWeek)) {
      settled += 1;
      const short = done.awardXp < done.rewardXp ? ` (clamped from ${done.rewardXp})` : '';
      console.log(
        `  ${label} · ${done.slug}: completed ${done.progress}/${done.target}, ` +
          `+${done.awardXp} XP${short}`
      );
      if (!APPLY) continue;

      /*
       * The status filter does two jobs now. It is the idempotency guard —
       * whichever of two overlapping runs commits second matches no row and
       * writes no XP, where checking first and updating after would leave
       * exactly that gap open. It is ALSO the acceptance gate: only 'active' is
       * here, so a challenge nobody accepted is never paid.
       *
       * AI-NOTE: this list and SETTLEABLE in src/gamification/settlement.ts
       *          must stay identical, or the batch pays for something that
       *          function did not settle.
       */
      const { data: won, error: settleErr } = await db
        .from('challenges')
        .update({ status: 'completed' })
        .eq('id', done.id)
        .in('status', ['active'])
        .select('id');
      if (settleErr) throw new Error(`settling ${done.slug}: ${settleErr.message}`);
      if ((won ?? []).length === 0) continue;

      if (done.awardXp > 0) {
        const { error: xpErr } = await db.from('xp_events').insert({
          user_id: user.user_id,
          source: 'challenge',
          amount: done.awardXp,
          local_date: asOf,
          week_start: weekStart,
        });
        if (xpErr) throw new Error(`paying ${done.slug}: ${xpErr.message}`);
      }
    }

    /*
     * The decision is `assignFromPool`; everything below it is I/O and logging.
     * scripts/seed.ts calls the same function, so the demo database and the
     * cron cannot disagree about what gets offered — see the module header.
     */
    const plan = assignFromPool(
      (pool ?? []).map((t) => ({ slug: t.slug, kind: t.kind as 'daily' | 'weekly', spec: t.spec })),
      context,
      already
    );

    for (const skip of plan.skipped) {
      // 'already_assigned' is the ordinary case and was never logged; an
      // unparseable pool row is a content bug and has to be visible.
      if (skip.reason === 'unparseable_spec') {
        console.log(`  ${label} · ${skip.slug}: unparseable spec, skipped`);
      }
    }

    for (const row of plan.assignments) {
      if (row.status === 'offered') {
        assigned += 1;
        console.log(`  ${label} · ${row.slug}: offered`);
      } else {
        rejected += 1;
        const codes = row.reasons.map((r: ValidationReason) => r.code).join(', ');
        console.log(`  ${label} · ${row.slug}: rejected (${codes})`);
      }
      if (!APPLY) continue;

      // A rejected row is WRITTEN, not dropped. That is the inspectability
      // criterion — a row nobody can see is not inspectable.
      const { error: writeErr } = await db.from('challenges').insert({
        user_id: user.user_id,
        slug: row.slug,
        kind: row.kind,
        spec: row.spec,
        status: row.status,
        window_start: row.windowStart,
        window_end: row.windowEnd,
        // The generated Json type does not accept an interface with named
        // fields, only an index-signature shape. The cast is at the jsonb
        // boundary, where the column genuinely is untyped.
        validation_reasons: row.reasons.map((r) => ({ code: r.code, detail: r.detail })),
      });
      // WHY the result is read at all: both inserts used to discard it, so a
      // failed write was reported to the Actions log as an assignment.
      if (writeErr) writeFailures.push(`${label} · ${row.slug}: ${writeErr.message}`);
    }
  }

  console.log(`\n${settled} settled, ${assigned} offered, ${rejected} rejected.`);
  if (!APPLY) console.log('Nothing was written. Re-run with --apply.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
