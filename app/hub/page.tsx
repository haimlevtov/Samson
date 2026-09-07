import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { loadHistory } from '@/src/db/training';
import { loadChallenges } from '@/src/db/gamification';
import { evaluateChallenge } from '@/src/gamification/challenge';
import { displayDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';

export const dynamic = 'force-dynamic';

/**
 * The Hub — ADR 0013.
 *
 * Other people, and the things they put in front of you: challenges now, a
 * leaderboard and collaboration later. ADR 0012 made this "XP, streak, badges,
 * challenges, training load, bests", which was six things whose only shared
 * property was being numbers about you — and left nowhere to put anything
 * social. Everything personal moved to Profile.
 *
 * It is deliberately sparse until the leaderboard lands. Moving the boundary
 * first means that arrives in a tab which already means "other people", rather
 * than as one more item in a pile.
 *
 * INVARIANT: every number below is computed by src/gamification, never by a
 *            model — CLAUDE.md #1. This page only formats them.
 */
export default async function HubPage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const today = localDateFor(user.timezone);
  const [history, challenges] = await Promise.all([loadHistory(db), loadChallenges(db)]);

  const active = challenges.filter((c) => c.status === 'offered' || c.status === 'active');
  const rejected = challenges.filter((c) => c.status === 'rejected');

  return (
    <>
      <header className="top">
        <div>
          <h1>Hub</h1>
          <span className="muted small">
            {user.displayName ?? user.email} · {displayDate(today)}
          </span>
        </div>
      </header>

      <h2 className="section">Challenges</h2>
      {active.length === 0 ? (
        <p className="card muted">
          No challenges assigned yet. They are generated weekly and validated against your own
          history first, so one you already meet without changing anything is never offered.
        </p>
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

      <h2 className="section">Leaderboard</h2>
      <p className="card muted small">
        Not built yet. It is the first thing in this app that would read another user&rsquo;s rows,
        which invariant #10 forbids by default, so it needs a decision of its own before any code —
        a view exposing a display name and an XP total and nothing else, and a way to opt out.
        Meanwhile your own XP and badges are on <Link href="/profile">Profile</Link>.
      </p>
    </>
  );
}
