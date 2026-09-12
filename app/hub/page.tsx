import { redirect } from 'next/navigation';
import Link from 'next/link';
import { logLine } from '@/src/llm/failure';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { loadHistory } from '@/src/db/training';
import { loadChallenges } from '@/src/db/gamification';
import { loadLeaderboard } from '@/src/db/leaderboard';
import { evaluateChallenge } from '@/src/gamification/challenge';
import { displayDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';
import { acceptChallengeAction } from './actions';
import { DEMO_ACCOUNT_EMAIL, RESET_KEEPS, RESET_TABLES } from '@/src/db/demo-reset';
import { resetDemoAccount } from './reset-actions';

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
 * The leaderboard is here now — ADR 0016 — and it arrived into a tab that
 * already meant "other people" rather than as one more item in a pile, which
 * was the point of moving the boundary first.
 *
 * INVARIANT: every number below is computed by src/gamification, never by a
 *            model — CLAUDE.md #1. This page only formats them.
 */
export default async function HubPage({
  searchParams,
}: {
  // The reset redirects back with these — see app/hub/reset-actions.ts.
  searchParams: Promise<{ reset?: string }>;
}) {
  const db = await createServerDb();
  const user = await currentUser(db);
  const { reset } = await searchParams;

  /*
   * A user who has never finished the welcome flow goes to it — ADR 0032 §2.
   *
   * Here rather than at `/` because sign-in lands on /hub directly, so the root
   * redirect is not on the path a new user takes.
   *
   * FOUND IN REVIEW: this tested the DISPLAY NAME, on the reasoning that its
   * absence means "has not been through this". It does not. `settingsSchema`
   * turns a blank name into null deliberately — "empty means no name, not an
   * empty name; the headers fall back to email" — so a long-standing user who
   * cleared their name was bounced in here permanently and told to supply one.
   *
   * `onboarded_at` is the one thing not derivable from the data, so it is the
   * one column this flow keeps. Which STEP to show is still derived.
   */
  if (!user) redirect('/sign-in');
  if (user.onboardedAt === null) redirect('/welcome');

  const today = localDateFor(user.timezone);
  const [history, challenges, board] = await Promise.all([
    loadHistory(db),
    loadChallenges(db),
    /*
     * Degrades rather than throws, like the other cross-page reads added in
     * this phase. The leaderboard is the least important thing on this tab —
     * challenges are what the user came for — and a view that fails must not
     * take the quests down with it.
     */
    /*
     * WHY it logs rather than swallowing silently: an empty board and a REVOKED
     * GRANT render the same "nobody is listed yet". Failing closed is the right
     * direction for a cross-user read, but a permission regression that looks
     * exactly like an unpopulated feature is one nobody would ever notice.
     */
    loadLeaderboard(db).catch((cause: unknown) => {
      // ADR 0028: the name and a bounded message, never the object.
      console.error('leaderboard unavailable', logLine(cause));
      return [];
    }),
  ]);

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
  /**
   * The date a challenge's window closed, or null while it is still open.
   *
   * INVARIANT: `today` is the user's local date, and it has to be — the RPC
   *            compares `window_end` against the same thing. When these two
   *            disagreed, the page rendered an Accept button that the function
   *            then refused, which is a dead end rather than a refusal.
   *
   * Returns the date rather than a boolean so the caller cannot narrow in one
   * place and assert non-null in another.
   */
  const closedOn = (c: (typeof offered)[number]): string | null =>
    c.windowEnd !== null && c.windowEnd < today ? c.windowEnd : null;

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
              {closedOn(c) !== null ? (
                // Says why rather than showing a button that would refuse.
                <p className="muted small">Its window closed on {displayDate(closedOn(c)!)}.</p>
              ) : (
                <form action={acceptChallengeAction}>
                  <input type="hidden" name="challengeId" value={c.id} />
                  {/* Every card has an Accept button, so the accessible name has
                      to say which one it accepts. */}
                  <button type="submit" aria-label={`Accept ${c.slug.replace(/-/g, ' ')}`}>
                    Accept
                  </button>
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

      <h2 className="section with-hint">
        Leaderboard
        <FieldHint title="What other people can see">
          Your display name and your level. Your XP total is what decides the order, and anyone
          signed in can read it — not your email and not your sessions. You are listed only if you
          have set a display name, and you can leave at any time from Settings.
        </FieldHint>
      </h2>

      {board.length === 0 ? (
        // Never an empty table with headers — docs/specs/mobile-interface.md §4.
        // And the likeliest reason for an empty board is the reader's own
        // missing display name, so it says how to fix that rather than only
        // reporting the absence.
        <p className="card muted small">
          Nobody is listed yet. A lifter appears here once they have set a display name — yours is
          on <Link href="/settings">Settings</Link>.
        </p>
      ) : (
        <div className="card">
          {/*
           * NOT a .table-cards table, for the reason globals.css already gives
           * for the set grid: three narrow columns fit 375px, and a ranking is
           * read DOWN the rank and level columns. Breaking each lifter onto their
           * own card turns five rows into fifteen and destroys the alignment a
           * leaderboard exists for.
           */}
          <table className="leaderboard">
            <thead>
              <tr>
                <th>#</th>
                <th>Lifter</th>
                {/* Level, not XP — ADR 0016's amendment, and the reasoning is
                    in src/db/leaderboard.ts where the mapping lives. */}
                <th>Level</th>
              </tr>
            </thead>
            <tbody>
              {board.map((row) => (
                /*
                 * Keyed by rank, not by name: two lifters may share a display
                 * name — nothing makes it unique — and a duplicate React key
                 * drops a row silently. Rank is unique within one response.
                 */
                <tr key={row.rank} className={row.isYou ? 'you' : undefined}>
                  <td>{row.rank}</td>
                  <td className="lb-name">
                    {row.displayName}
                    {row.isYou ? <span className="chip chip-on you-chip">you</span> : null}
                  </td>
                  {/* `.lb-xp` is the numeric column's alignment; globals.css
                      describes it as such since this change. No toLocaleString:
                      a level is one or two digits and grouping never applies. */}
                  <td className="lb-xp">{row.level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/*
       * The demo reset — ADR 0032 §4, and it is here because the owner asked
       * for it on the main page: it exists to be pressed between demo runs, and
       * a control you have to navigate to mid-demo is friction in exactly the
       * moment it was added to remove.
       *
       * It renders for ONE account. That is a convenience gate rather than a
       * control — the action checks the same thing, because a server action is
       * an endpoint and rendering a button for one account stops nobody else
       * POSTing to it. What makes it safe is RLS: the deletes are scoped to the
       * caller, so the worst a bypass achieves is somebody emptying their own
       * training.
       *
       * LAST on the page, deliberately. The first screen of the app is not where
       * an irreversible control should meet a thumb first.
       */}
      {user.email === DEMO_ACCOUNT_EMAIL ? (
        <>
          <h2 className="section">Demo</h2>
          <div className="card danger-card">
            <p>
              This is the empty demo account. Resetting returns it to the state a brand-new user
              sees — the welcome questions, no history, no plan.
            </p>
            <p className="muted small">
              It deletes your {RESET_TABLES.join(', ')}. It keeps {RESET_KEEPS.join(' and ')}.
            </p>
            {reset === 'unconfirmed' ? (
              <p className="error" role="status">
                Type RESET to confirm.
              </p>
            ) : null}
            {reset === 'failed' ? (
              <p className="error" role="status">
                That did not go through. Nothing may have been removed — try again.
              </p>
            ) : null}
            <form action={resetDemoAccount} className="row reset-form">
              <label className="grow">
                <span className="label">Type RESET to confirm</span>
                <input type="text" name="confirm" autoComplete="off" placeholder="RESET" />
              </label>
              <button type="submit" className="secondary">
                Reset this demo account
              </button>
            </form>
          </div>
        </>
      ) : null}
    </>
  );
}
