import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { loadHistory, loadWorkout } from '@/src/db/training';
import { loadChallenges, loadXpSummary } from '@/src/db/gamification';
import { evaluateChallenge } from '@/src/gamification/challenge';
import { levelProgress } from '@/src/gamification/level';
import { STREAK_MILESTONES } from '@/src/gamification/xp';
import { currentStreak } from '@/src/metrics/adherence';
import { isWithin, startOfWeek } from '@/src/metrics/dates';
import { earnedSentence, sessionHeadline } from '@/src/ui/finish';
import { displayDate } from '@/src/ui/format';
import { Hex } from '@/src/ui/Hex';
import { Icon } from '@/src/ui/icons';
import { challengeTitle } from '@/src/ui/quests';
import { logLine } from '@/src/llm/failure';
import { SegmentMeter } from '@/src/ui/SegmentMeter';

export const dynamic = 'force-dynamic';

/**
 * The finish moment — the Quest Log redesign, docs/plans/quest-log-redesign.md PR 4.
 *
 * `finishWorkout` redirects here, once, with the `?unlocked=` it has always
 * carried; Done goes on to History with it, so a badge fires where it fired
 * before.
 *
 * INVARIANT: this page READS what `award_session_xp` already wrote and what the
 *            metrics engine already computes. It decides no reward — CLAUDE.md
 *            #1 and #4, ADR 0009 — and the one aggregate it makes, the sum of
 *            this workout's own `xp_events`, adds rows the award function wrote
 *            for it.
 *
 * WHY a route rather than state inside `FinishForm`: the session is already
 * saved by the time anything here renders, and a route is a thing a refresh can
 * come back to. Reloading shows the same receipt, which is true; it does not
 * award anything twice, because nothing here writes.
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
  // Not finished yet: there is no receipt, so go back to the session.
  if (workout.status !== 'completed') redirect(`/history/${id}`);

  const today = localDateFor(user.timezone);
  /*
   * A receipt for THIS week only. The week's XP, the streak and the quests below
   * are read as of today, so a session from an earlier week would print its own
   * "+80" beside a week it does not belong to. Revisiting an old one goes to the
   * session itself, which is the record of it.
   */
  if (startOfWeek(workout.localDate) !== startOfWeek(today)) redirect(`/history/${id}`);

  /*
   * The receipt's own figures — what this session earned and the week against
   * its cap — are required; without them there is no receipt. The streak and the
   * quests DEGRADE: the session is saved by the time this renders, and an error
   * page for the sake of a quest row would read as if the save had failed.
   */
  const [events, xp, history, challenges] = await Promise.all([
    // This workout's own rows. RLS scopes xp_events to the caller.
    db.from('xp_events').select('amount, source').eq('workout_id', id),
    loadXpSummary(db, today),
    loadHistory(db).catch((cause: unknown) => {
      console.error('history unavailable on the finish moment', logLine(cause));
      return null;
    }),
    loadChallenges(db).catch((cause: unknown) => {
      console.error('challenges unavailable on the finish moment', logLine(cause));
      return [];
    }),
  ]);
  if (events.error) throw new Error(`loading this session's xp: ${events.error.message}`);

  const rows = events.data ?? [];
  const earned = rows.reduce((sum, row) => sum + row.amount, 0);
  const milestoneReached = rows.some((row) => row.source === 'streak');

  const level = levelProgress(xp.lifetime);
  const streak = history === null ? null : currentStreak(history.workouts, today);
  const nextMilestone =
    streak === null ? null : (STREAK_MILESTONES.find((m) => m > streak) ?? null);

  // Completed sessions dated this calendar week, this one included.
  const weekStart = startOfWeek(workout.localDate);
  const sessionsThisWeek =
    history === null
      ? 0
      : history.workouts.filter(
          (w) => w.status === 'completed' && isWithin(w.localDate, weekStart, workout.localDate)
        ).length;

  const active = (history === null ? [] : challenges)
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

  // A repeated parameter arrives as an array; only a single slug is passed on.
  const done =
    typeof unlocked === 'string' ? `/history?unlocked=${encodeURIComponent(unlocked)}` : '/history';

  return (
    <div className="kept">
      <p className="kicker kept-kicker">Session kept · {displayDate(workout.localDate)}</p>

      <Hex size={132} label={`Earned ${earned} XP`}>
        <span className="kept-earned">
          <small>Earned</small>
          <strong className="display">+{earned}</strong>
          <small>XP</small>
        </span>
      </Hex>

      <h1 className="display kept-title">{sessionHeadline(sessionsThisWeek)}</h1>
      <p className="muted small kept-sentence">
        {earnedSentence({ earned, thisWeek: xp.thisWeek, ceiling: xp.ceiling })}
      </p>

      <div className="card kept-week">
        <div className="week-xp-head">
          <span>
            <span className="display week-xp-value">{xp.thisWeek}</span>{' '}
            <span className="muted">of {xp.ceiling} this week</span>
          </span>
          <span className="label">Weekly cap</span>
        </div>
        <SegmentMeter
          value={xp.thisWeek}
          total={xp.ceiling}
          count={10}
          label={`${xp.thisWeek} of ${xp.ceiling} XP earned this week`}
        />
        <p className="muted small">
          Level {level.level} · {level.intoLevel.toLocaleString()} of {level.span.toLocaleString()}{' '}
          · {level.toNext.toLocaleString()} XP to Level {level.level + 1}
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
            <span className="display kept-figure">{streak}</span>
          </li>
        )}

        {active.map(({ challenge, progress }) => (
          <li key={challenge.id} className={`card kept-row${progress.met ? ' kept-met' : ''}`}>
            <Hex size={44} tone={progress.met ? 'good' : 'soft'}>
              <Icon name={progress.met ? 'check-check' : 'calendar-check'} size={22} />
            </Hex>
            <span>
              <strong>
                {progress.met ? 'Quest complete · ' : ''}
                {challengeTitle(challenge.spec, challenge.slug)}
              </strong>
              {/* ADR 0009 §4: a challenge pays on the weekly run, never now. */}
              <span className="muted small">
                {' '}
                {progress.met
                  ? `+${challenge.spec!.reward_xp} XP pays on the next weekly run.`
                  : 'Pays on the next weekly run once met.'}
              </span>
            </span>
            <span className="display kept-figure">
              {progress.progress}/{progress.target}
            </span>
          </li>
        ))}
      </ul>

      <p className="muted small kept-foot">
        Badges are checked as this saves. If one fires, it lands on History next.
      </p>

      <div className="kept-actions">
        <Link href={done} className="button-link">
          Done
        </Link>
        <Link href={`/history/${id}`} className="button-link secondary">
          Review the session
        </Link>
      </div>
    </div>
  );
}
