import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { loadHistory, loadWorkout } from '@/src/db/training';
import {
  loadChallenges,
  loadSessionXpRows,
  loadUnlockedAchievements,
  loadXpSummary,
} from '@/src/db/gamification';
import { evaluateChallenge } from '@/src/gamification/challenge';
import { levelProgress } from '@/src/gamification/level';
import { STREAK_MILESTONES } from '@/src/gamification/xp';
import { currentStreak } from '@/src/metrics/adherence';
import { earnedSentence, receiptFor, sessionXp } from '@/src/ui/finish';
import { displayDate } from '@/src/ui/format';
import { Hex } from '@/src/ui/Hex';
import { Icon } from '@/src/ui/icons';
import { challengeTitle, remainingPhrase } from '@/src/ui/quests';
import { logLine } from '@/src/llm/failure';
import { SegmentMeter } from '@/src/ui/SegmentMeter';
import { BadgeReveal } from '../../BadgeReveal';

export const dynamic = 'force-dynamic';

/**
 * The finish moment — the Quest Log redesign, docs/plans/rework-4.md PR 4.
 *
 * `finishWorkout` redirects here, once, with the `?unlocked=` it has always
 * carried, and a badge fires HERE — on the screen the user lands on, as it always
 * has. FOUND IN REVIEW: the first version passed the parameter on through Done
 * only, so "Review the session" or any tab lost the badge for good.
 *
 * INVARIANT: this page READS what `award_session_xp` already wrote and what the
 *            metrics engine already computes. It decides no reward — CLAUDE.md
 *            #1 and #4, ADR 0009 — and the one aggregate it makes, the sum of
 *            this workout's own `xp_events`, adds rows the award function wrote
 *            for it.
 *
 * WHY a route rather than state inside `FinishForm`: the session is already
 * saved by the time anything here renders, and a route is a thing a refresh can
 * come back to. Reloading shows this session's XP and its week again — the streak
 * and quests are as of the reload — and awards nothing, because nothing here
 * writes.
 */
export default async function KeptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ unlocked?: string }>;
}) {
  const [{ id }, { unlocked }] = await Promise.all([params, searchParams]);
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const workout = await loadWorkout(db, id);
  // RLS: another user's workout and a missing one are the same 404.
  if (!workout) notFound();
  // Not kept yet: there is no receipt, so go back to the session. A rest day has
  // one — ADR 0034 §6.
  const receipt = receiptFor(workout.status);
  if (receipt === null) redirect(`/history/${id}`);

  const today = localDateFor(user.timezone);
  /*
   * The week is the SESSION's week, not today's — FOUND IN REVIEW. The first
   * version redirected any session from an earlier week to its own page, which
   * dropped `?unlocked=` and skipped the receipt for two real paths: a session
   * begun at 23:40 on a Sunday and finished after midnight, and a loose end from
   * last week finished today. The award pays a session into its own week, so
   * that is the week this reads — `xp_totals` takes one. The streak and the
   * quests are as of today, and say so by being what they are.
   */

  /*
   * The receipt's own figures — what this session earned and the week against
   * its cap — are required; without them there is no receipt. The streak and the
   * quests DEGRADE: the session is saved by the time this renders, and an error
   * page for the sake of a quest row would read as if the save had failed.
   */
  const [rows, xp, history, challenges, badges] = await Promise.all([
    loadSessionXpRows(db, id),
    loadXpSummary(db, workout.localDate),
    loadHistory(db).catch((cause: unknown) => {
      console.error('history unavailable on the finish moment', logLine(cause));
      return null;
    }),
    loadChallenges(db).catch((cause: unknown) => {
      console.error('challenges unavailable on the finish moment', logLine(cause));
      // null, not [] — an empty list reads as "you have no quests".
      return null;
    }),
    // Only when a badge fired, and degrading: the sheet is a bonus on a receipt.
    typeof unlocked === 'string' ? loadUnlockedAchievements(db).catch(() => []) : [],
  ]);
  const { earned, milestone: milestoneReached } = sessionXp(rows);

  const level = levelProgress(xp.lifetime);
  const streak = history === null ? null : currentStreak(history.workouts, today);
  const nextMilestone =
    streak === null ? null : (STREAK_MILESTONES.find((m) => m > streak) ?? null);

  /*
   * No "third session this week" headline, which the handoff drew — FOUND IN
   * REVIEW. The award counts completed AND rest days across the week at the
   * moment it runs; a count read later, or of completed sessions only, disagreed
   * with it and printed "First session" over a third-session payout. The number
   * the award used is not stored, so the page does not guess it.
   */
  const partial = history === null || challenges === null;
  const active = (history === null || challenges === null ? [] : challenges)
    .filter((c) => c.status === 'active' && c.spec !== null)
    .map((c) => ({
      challenge: c,
      progress: evaluateChallenge(c.spec!, {
        workouts: history!.workouts,
        sets: history!.sets,
        history: history!.sets,
        asOf: today,
        availableExerciseIds: [...history!.exercises.keys()],
      }),
    }));

  return (
    <div className="kept">
      <BadgeReveal slug={unlocked} badges={badges} />

      <p className="kicker kept-kicker">{displayDate(workout.localDate)}</p>

      <Hex size={132} label={`Earned ${earned} XP`}>
        <span className="kept-earned">
          <small>Earned</small>
          <strong className="display">+{earned}</strong>
          <small>XP</small>
        </span>
      </Hex>

      <h1 className="display kept-title">{receipt.title}</h1>
      <p className="muted small kept-sentence">
        {earnedSentence({ earned, weekXp: xp.thisWeek, ceiling: xp.ceiling, noun: receipt.noun })}
      </p>

      <div className="card kept-week">
        <div className="week-xp-head">
          <span>
            <span className="display week-xp-value">{xp.thisWeek}</span>{' '}
            <span className="muted">of {xp.ceiling} that week</span>
          </span>
          <span className="label">Weekly cap</span>
        </div>
        <SegmentMeter
          value={xp.thisWeek}
          total={xp.ceiling}
          count={10}
          label={`${xp.thisWeek} of ${xp.ceiling} XP earned in the session's week`}
        />
        <p className="muted small">
          Level {level.level} · {level.intoLevel.toLocaleString()} of {level.span.toLocaleString()}{' '}
          XP into this level · {level.toNext.toLocaleString()} XP to Level {level.level + 1}
        </p>
      </div>

      <ul className="kept-rows">
        {streak === null ? null : (
          <li className="card kept-row">
            <Hex size={44}>
              <Icon name="flame" size={22} />
            </Hex>
            <span>
              <strong>
                Streak {streak}
                {milestoneReached ? ' — milestone reached' : ''}
              </strong>
              <span className="muted small">
                {' '}
                Rest days keep it alive.
                {nextMilestone === null ? '' : ` Next mark at ${nextMilestone}.`}
              </span>
            </span>
            {/* The figure again for the eye; the words above already said it. */}
            <span className="display kept-figure" aria-hidden="true">
              {streak}
            </span>
          </li>
        )}

        {active.map(({ challenge, progress }) => (
          <li key={challenge.id} className={`card kept-row${progress.met ? ' kept-met' : ''}`}>
            <Hex size={44} tone={progress.met ? 'good' : 'soft'}>
              <Icon name={progress.met ? 'check-check' : 'calendar-check'} size={22} />
            </Hex>
            <span>
              <strong>{challengeTitle(challenge.spec, challenge.slug)}</strong>
              {/*
               * ADR 0009 §4: a challenge pays on the weekly run, never now — and
               * with no amount: the run caps it at the week's ceiling and
               * re-checks the window, so a figure here could be untrue. The same
               * phrase Hub prints.
               */}
              <span className="muted small">
                {' '}
                {remainingPhrase(challenge.spec!, progress.progress)}
              </span>
            </span>
            <span className="display kept-figure" aria-hidden="true">
              {progress.progress}/{progress.target}
            </span>
            <span className="sr-only">
              {progress.progress} of {progress.target}
            </span>
          </li>
        ))}
      </ul>

      {partial ? (
        // mobile-interface.md §4: a list that drops rows without a word reads as complete.
        <p className="muted small kept-foot">
          Your streak and quests did not load just now — they are on Profile and Hub.
        </p>
      ) : null}

      <div className="kept-actions">
        <Link href="/history" className="button-link">
          Done
        </Link>
        {receipt.reviewable ? (
          <Link href={`/history/${id}`} className="button-link secondary">
            Review the session
          </Link>
        ) : null}
      </div>
    </div>
  );
}
