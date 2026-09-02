import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { loadHistory } from '@/src/db/training';
import { loadChallenges, loadUnlockedAchievements, loadXpSummary } from '@/src/db/gamification';
import { currentStreak } from '@/src/metrics/adherence';
import { STREAK_MILESTONES } from '@/src/gamification/xp';
import { evaluateChallenge } from '@/src/gamification/challenge';
import { displayDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';

export const dynamic = 'force-dynamic';

export default async function ProgressPage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const today = localDateFor(user.timezone);

  const [history, xp, badges, challenges] = await Promise.all([
    loadHistory(db),
    loadXpSummary(db, today),
    loadUnlockedAchievements(db),
    loadChallenges(db),
  ]);

  // INVARIANT: every number below is computed by src/metrics or
  //            src/gamification, never by a model — CLAUDE.md #1. This page
  //            only formats them.
  const streak = currentStreak(history.workouts, today);
  const nextMilestone = STREAK_MILESTONES.find((m) => m > streak) ?? null;

  const spentPct = Math.min(100, Math.round((xp.thisWeek / xp.ceiling) * 100));

  const active = challenges.filter((c) => c.status === 'offered' || c.status === 'active');
  const rejected = challenges.filter((c) => c.status === 'rejected');

  return (
    <>
      <header className="top">
        <div>
          <h1>Progress</h1>
          <span className="muted small">
            {user.displayName ?? user.email} · {displayDate(today)}
          </span>
        </div>
        <div className="row">
          <Link href="/workouts" className="chip">
            Training
          </Link>
          <Link href="/coach" className="chip">
            Coach
          </Link>
        </div>
      </header>

      <div className="grid cols-4">
        <div className="stat">
          <div className="label with-hint">
            XP this week
            <FieldHint title="Weekly XP">
              XP comes from adherence — keeping the sessions you planned — and never from how much
              you lifted. Volume-scaled XP would pay you to overtrain. Each session in a week is
              worth a little less than the one before, and the week is capped.
            </FieldHint>
          </div>
          <div className="value">{xp.thisWeek}</div>
          <div className="muted small">
            {xp.remainingThisWeek} left of {xp.ceiling}
          </div>
        </div>

        <div className="stat">
          <div className="label">Lifetime XP</div>
          <div className="value">{xp.lifetime.toLocaleString()}</div>
          <div className="muted small">all time</div>
        </div>

        <div className="stat">
          <div className="label with-hint">
            Streak
            <FieldHint title="Streak">
              Planned sessions kept in a row. Rest days keep it alive — resting on plan is following
              it, not skipping it.
            </FieldHint>
          </div>
          <div className="value">{streak}</div>
          <div className="muted small">
            {nextMilestone === null
              ? 'every milestone earned'
              : `${nextMilestone - streak} to ${nextMilestone}`}
          </div>
        </div>

        <div className="stat">
          <div className="label">Badges</div>
          <div className="value">{badges.length}</div>
          <div className="muted small">unlocked</div>
        </div>
      </div>

      <h2 className="section with-hint">
        This week&rsquo;s XP
        <FieldHint title="The weekly ceiling">
          Past the cap, more training earns nothing. That is deliberate: the cap is what stops the
          game rewarding you for cramming, and it is enforced in the database as well as in the app,
          so no path can exceed it.
        </FieldHint>
      </h2>
      <div className="card">
        <div
          className="xp-meter"
          role="img"
          aria-label={`${xp.thisWeek} of ${xp.ceiling} XP earned this week`}
        >
          <span style={{ width: `${spentPct}%` }} />
        </div>
        <p className="muted small">
          {xp.thisWeek} of {xp.ceiling} · {spentPct}%
        </p>
      </div>

      <h2 className="section">Badges</h2>
      {badges.length === 0 ? (
        <p className="card muted">
          Nothing unlocked yet. Achievements come from consistency, not from a single heavy day.
        </p>
      ) : (
        <div className="badge-shelf">
          {badges.map((b) => (
            <article key={b.slug} className="card badge-card">
              <h3>{b.name}</h3>
              <p className="muted small">{b.description}</p>
              <p className="muted small">
                <span className="chip chip-on">{b.tier}</span> earned {displayDate(b.localDate)}
              </p>
              {b.sourceHint !== null && <p className="muted small">{b.sourceHint}</p>}
            </article>
          ))}
        </div>
      )}

      <h2 className="section">Challenges</h2>
      {active.length === 0 ? (
        <p className="card muted">No challenges assigned yet.</p>
      ) : (
        <div className="badge-shelf">
          {active.map((c) => {
            // Progress is derived from logged rows here exactly as the server
            // derives it — ADR 0009. This is a display of the same computation,
            // not a second definition of it.
            const progress =
              c.spec === null
                ? null
                : evaluateChallenge(c.spec, {
                    workouts: history.workouts,
                    sets: history.sets,
                    history: history.sets,
                    asOf: today,
                    availableExerciseIds: [...history.exercises.keys()],
                  });

            return (
              <article key={c.id} className="card badge-card">
                <h3>{c.slug.replace(/-/g, ' ')}</h3>
                <p className="muted small">
                  <span className="chip">{c.kind}</span> {c.status}
                </p>
                {progress !== null && (
                  <>
                    <div className="xp-meter">
                      <span
                        style={{
                          width: `${Math.min(100, (progress.progress / progress.target) * 100)}%`,
                        }}
                      />
                    </div>
                    <p className="muted small">
                      {progress.progress} of {progress.target}
                      {progress.met ? ' · complete' : ''}
                    </p>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/*
       * PLAN.md phase 4: "a rejected challenge is inspectable — the validator
       * logs why". A rejected row is kept rather than discarded, and this is
       * where the reasons are actually readable.
       */}
      {rejected.length > 0 && (
        <>
          <h2 className="section with-hint">
            Not offered
            <FieldHint title="Rejected challenges">
              Challenges the validator refused to offer you, and why. A challenge you already meet
              without changing anything is not a challenge, and a target that cannot fit in its
              window is impossible rather than hard.
            </FieldHint>
          </h2>
          <div className="card">
            {rejected.map((c) => (
              <div key={c.id} className="rejected-row">
                <strong className="small">{c.slug.replace(/-/g, ' ')}</strong>
                <ul>
                  {c.validationReasons.map((r, i) => (
                    <li key={i} className="muted small">
                      <code>{r.code}</code> — {r.detail}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
