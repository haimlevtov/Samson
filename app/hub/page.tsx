import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { loadHistory } from '@/src/db/training';
import { loadChallenges } from '@/src/db/gamification';
import { evaluateChallenge } from '@/src/gamification/challenge';
import { displayDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';
import { acceptChallengeAction } from './actions';

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

  /*
   * Three buckets, not two. Accepting is what puts a challenge in play — see the
   * lifecycle table in docs/specs/xp-and-challenges.md — so an offered
   * challenge is an invitation and an active one is a commitment, and showing
   * them as one list would hide the only decision this page asks for.
   */
  const offered = challenges.filter((c) => c.status === 'offered');
  const accepted = challenges.filter((c) => c.status === 'active');
  const rejected = challenges.filter((c) => c.status === 'rejected');

  /*
   * A window that has closed cannot be accepted — the RPC refuses it — so the
   * card must not offer a button that would do nothing. Nothing expires these
   * rows, which the spec records as a known gap, so they accumulate here and
   * this is what keeps them honest.
   */
  const expired = (c: (typeof offered)[number]): boolean =>
    c.windowEnd !== null && c.windowEnd < today;

  const progressOf = (c: (typeof offered)[number]) =>
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
    <>
      <header className="top">
        <div>
          <h1>Hub</h1>
          <span className="muted small">
            {user.displayName ?? user.email} · {displayDate(today)}
          </span>
        </div>
      </header>

      <h2 className="section with-hint">
        Open to you
        <FieldHint title="Accepting a challenge">
          A challenge only earns XP once you accept it. That is the point of the button — until then
          it is an invitation, and training that happens to satisfy it pays nothing. Your adherence
          XP, streak and badges are unaffected either way.
        </FieldHint>
      </h2>
      {offered.length === 0 ? (
        <p className="card muted">
          Nothing on offer. Challenges are generated weekly and validated against your own history
          first, so one you already meet without changing anything is never offered.
        </p>
      ) : (
        <div className="badge-shelf">
          {offered.map((c) => (
            <article key={c.id} className="card badge-card">
              <h3>{c.slug.replace(/-/g, ' ')}</h3>
              <p className="muted small">
                <span className="chip">{c.kind}</span>
                {c.spec === null ? 'unreadable' : `${c.spec.reward_xp} XP`}
              </p>
              {expired(c) ? (
                // Says why rather than showing a button that would refuse.
                <p className="muted small">Its window closed on {displayDate(c.windowEnd!)}.</p>
              ) : (
                <form action={acceptChallengeAction}>
                  <input type="hidden" name="challengeId" value={c.id} />
                  <button type="submit">Accept</button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}

      <h2 className="section">In play</h2>
      {accepted.length === 0 ? (
        <p className="card muted">
          Nothing accepted yet. Take one above and it starts counting from what you have already
          logged this window.
        </p>
      ) : (
        <div className="badge-shelf">
          {accepted.map((c) => {
            // Progress is derived from logged rows here exactly as the batch
            // derives it — the same evaluateChallenge, so there is one
            // definition of how far along you are.
            const progress = progressOf(c);

            return (
              <article key={c.id} className="card badge-card">
                <h3>{c.slug.replace(/-/g, ' ')}</h3>
                <p className="muted small">
                  <span className="chip chip-on">{c.kind}</span>
                  {c.spec === null ? 'unreadable' : `${c.spec.reward_xp} XP`}
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
                      {progress.met ? ' · complete, pays on the next weekly run' : ''}
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
