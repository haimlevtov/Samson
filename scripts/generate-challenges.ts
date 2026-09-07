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
  validateCandidate,
  type ChallengeContext,
  type ValidationReason,
} from '../src/gamification/challenge';
import { settleChallenges, type AssignedChallenge } from '../src/gamification/settlement';
import { addDays, startOfWeek } from '../src/metrics/dates';
import type { Database } from '../src/db/types';
import type { LocalDate, SetRecord, WorkoutRecord } from '../src/metrics/types';

config({ path: '.env.local', quiet: true });

const APPLY = process.argv.includes('--apply');

function admin() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url) throw new Error('SUPABASE_URL is required.');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to generate challenges.');
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

/** Today in the user's timezone, without pulling in a date library. */
function localToday(timezone: string): LocalDate {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  } catch {
    // An unknown IANA zone must not fail the whole batch for every other user.
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
  }
}

async function main(): Promise<void> {
  const db = admin();

  const [{ data: pool, error: poolErr }, { data: users, error: userErr }] = await Promise.all([
    db.from('challenges').select('slug, kind, spec').is('user_id', null),
    db.from('users').select('user_id, timezone, display_name'),
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

  for (const user of users ?? []) {
    const asOf = localToday(user.timezone ?? 'UTC');

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
    const label = user.display_name ?? user.user_id.slice(0, 8);

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

    for (const template of pool ?? []) {
      if (already.has(template.slug)) continue;

      const parsed = challengeSpecSchema.safeParse(template.spec);
      if (!parsed.success) {
        console.log(`  ${label} · ${template.slug}: unparseable spec, skipped`);
        continue;
      }

      const kind = template.kind as 'daily' | 'weekly';
      const verdict = validateCandidate(parsed.data, kind, context);

      const windowStart = asOf;
      const windowEnd = addDays(asOf, parsed.data.window_days - 1);

      if (verdict.ok) {
        assigned += 1;
        console.log(`  ${label} · ${template.slug}: offered`);
        if (APPLY) {
          await db.from('challenges').insert({
            user_id: user.user_id,
            slug: template.slug,
            kind,
            spec: parsed.data,
            status: 'offered',
            window_start: windowStart,
            window_end: windowEnd,
            validation_reasons: [],
          });
        }
      } else {
        rejected += 1;
        const codes = verdict.reasons.map((r: ValidationReason) => r.code).join(', ');
        console.log(`  ${label} · ${template.slug}: rejected (${codes})`);
        if (APPLY) {
          // Written, not dropped. This is the inspectability criterion.
          await db.from('challenges').insert({
            user_id: user.user_id,
            slug: template.slug,
            kind,
            spec: parsed.data,
            status: 'rejected',
            window_start: windowStart,
            window_end: windowEnd,
            // The generated Json type does not accept an interface with named
            // fields, only an index-signature shape. The cast is at the jsonb
            // boundary, where the column genuinely is untyped.
            validation_reasons: verdict.reasons.map((r) => ({ code: r.code, detail: r.detail })),
          });
        }
      }
    }
  }

  console.log(`\n${settled} settled, ${assigned} offered, ${rejected} rejected.`);
  if (!APPLY) console.log('Nothing was written. Re-run with --apply.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
