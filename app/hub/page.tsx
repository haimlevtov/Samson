import { redirect } from 'next/navigation';
import Link from 'next/link';
import { logLine } from '@/src/llm/failure';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { loadHistory } from '@/src/db/training';
import { loadChallenges, loadXpSummary } from '@/src/db/gamification';
import { loadLeaderboard } from '@/src/db/leaderboard';
import { evaluateChallenge } from '@/src/gamification/challenge';
import { levelProgress } from '@/src/gamification/level';
import { isoWeek } from '@/src/metrics/dates';
import { displayDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';
import { Hex } from '@/src/ui/Hex';
import { Icon } from '@/src/ui/icons';
import { challengeIcon, challengeTitle, remainingPhrase } from '@/src/ui/quests';
import { MAX_SEGMENTS } from '@/src/ui/segments';
import { SegmentMeter } from '@/src/ui/SegmentMeter';
import { acceptChallengeAction } from './actions';
import { Board } from './Board';

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
 * **And it is FIRST since the Quest Log redesign** — ADR 0033, on the owner's
 * decision. It still degrades rather than throws, so a failed view renders its
 * empty sentence and the quests below it load regardless.
 *
 * INVARIANT: every number below is computed by src/gamification, never by a
 *            model — CLAUDE.md #1. This page only formats them.
 */
export default async function HubPage() {
  const db = await createServerDb();
  const user = await currentUser(db);

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
  const [history, challenges, xp, board] = await Promise.all([
    loadHistory(db),
    loadChallenges(db),
    /*
     * For the level in the header — the redesign's one new read here, and the
     * same one Profile makes. It degrades like the board: a missing emblem is a
     * cosmetic loss, and the quests are what this tab is for.
     */
    loadXpSummary(db, today).catch((cause: unknown) => {
      console.error('xp summary unavailable', logLine(cause));
      return null;
    }),
    /*
     * Degrades rather than throws, like the other cross-page reads added in
     * this phase. The leaderboard is the least important thing on this tab —
     * challenges are what the user came for — and a view that fails must not
     * take the quests down with it. (It is drawn FIRST since the redesign; that
     * changed where it sits, not how much a failure of it may cost.)
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

  const level = xp === null ? null : levelProgress(xp.lifetime).level;

  return (
    <>
      <header className="top">
        <div>
          <span className="kicker">Quest board · week {isoWeek(today)}</span>
          <h1>Hub</h1>
          <span className="muted small">
            {user.displayName ?? user.email} · {displayDate(today)}
          </span>
        </div>
        {level === null ? null : (
          <Hex size={48} label={`Level ${level}`}>
            <span className="hex-level-stack">
              <small>LVL</small>
              <strong>{level}</strong>
            </span>
          </Hex>
        )}
      </header>

      <h2 className="section with-hint">
        <Icon name="crown" size={14} />
        The board
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
        <Board rows={board} />
      )}

      <h2 className="section with-hint">
        <Icon name="scroll-text" size={14} />
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
        <div className="quest-list">
          {offered.map((c) => {
            const title = challengeTitle(c.spec, c.slug);
            const closed = closedOn(c);
            return (
              <article key={c.id} className="card quest">
                <Hex size={56} tone="soft">
                  <Icon name={challengeIcon(c.spec)} size={26} />
                </Hex>
                <div>
                  <h3>{title}</h3>
                  <p className="quest-meta">
                    <span className="chip">{c.kind}</span>
                    {c.spec?.rpe_at_least != null ? (
                      <span>RPE {c.spec.rpe_at_least} or above</span>
                    ) : null}
                    {c.spec === null ? (
                      <span>unreadable</span>
                    ) : (
                      <span className="quest-reward">
                        <Icon name="sparkles" size={14} />+{c.spec.reward_xp} XP
                      </span>
                    )}
                  </p>
                </div>
                {closed !== null ? (
                  // Says why rather than showing a button that would refuse.
                  <p className="muted small quest-span">
                    Its window closed on {displayDate(closed)}.
                  </p>
                ) : (
                  <form action={acceptChallengeAction} className="quest-span">
                    <input type="hidden" name="challengeId" value={c.id} />
                    {/* Every card has this button, so the accessible name has to
                        say which challenge it takes. */}
                    <button type="submit" aria-label={`Take the quest: ${title}`}>
                      <Icon name="swords" size={18} />
                      Take the quest
                    </button>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}

      <h2 className="section">
        <Icon name="hourglass" size={14} />
        In play
      </h2>
      {accepted.length === 0 ? (
        <p className="card muted">
          Nothing accepted yet. Take one above and it starts counting from what you have already
          logged this window.
        </p>
      ) : (
        <div className="quest-list">
          {accepted.map((c) => {
            // Progress is derived from logged rows here exactly as the batch
            // derives it — the same evaluateChallenge, so there is one
            // definition of how far along you are.
            const progress = progressOf(c);

            return (
              <article key={c.id} className="card quest quest-playing">
                <Hex size={56}>
                  <Icon name={challengeIcon(c.spec)} size={26} />
                </Hex>
                <div>
                  <h3>{challengeTitle(c.spec, c.slug)}</h3>
                  <p className="quest-meta">
                    <span className="chip chip-on">{c.kind}</span>
                    {c.spec === null ? (
                      <span>unreadable</span>
                    ) : (
                      <span className="quest-reward">+{c.spec.reward_xp} XP</span>
                    )}
                  </p>
                </div>
                {progress !== null && c.spec !== null && (
                  <div className="quest-span">
                    {/*
                     * Segments only while they can be counted at a glance — past
                     * ten the continuous meter reads better, and it is the one
                     * this page drew before.
                     */}
                    {progress.target <= MAX_SEGMENTS ? (
                      <SegmentMeter
                        value={progress.progress}
                        total={progress.target}
                        count={progress.target}
                        label={`${progress.progress} of ${progress.target}`}
                      />
                    ) : (
                      <div className="xp-meter">
                        <span
                          style={{
                            width: `${Math.min(100, (progress.progress / progress.target) * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                    <p className="quest-progress">
                      <strong>
                        {progress.progress} of {progress.target}
                      </strong>{' '}
                      · {remainingPhrase(c.spec, progress.progress)}
                    </p>
                  </div>
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

      {/*
       * The demo reset WAS HERE, and is now one button on `/sign-in` — ADR 0032
       * §4 as amended twice. It could not be reached from this page by the only
       * account that has it: the check at the top redirects a user whose
       * `onboarded_at` is null to `/welcome`, and that account's is null by
       * design.
       */}
    </>
  );
}
