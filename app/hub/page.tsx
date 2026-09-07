import { redirect } from 'next/navigation';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { loadHistory } from '@/src/db/training';
import { loadChallenges, loadUnlockedAchievements, loadXpSummary } from '@/src/db/gamification';
import { acwr, acwrBand } from '@/src/metrics/acwr';
import { adherence, currentStreak } from '@/src/metrics/adherence';
import { addDays } from '@/src/metrics/dates';
import { exerciseBests } from '@/src/metrics/pr';
import { tonnageByWeek, totalTonnage } from '@/src/metrics/tonnage';
import { STREAK_MILESTONES } from '@/src/gamification/xp';
import { evaluateChallenge } from '@/src/gamification/challenge';
import { displayDate, displayShortDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';

export const dynamic = 'force-dynamic';

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;

/**
 * The Hub — ADR 0012.
 *
 * Everything that answers "how am I doing", in the order the interface spec
 * ranks it: the retention mechanic first (adherence and streak, invariant #4),
 * then the game, then the diagnostics. `/progress` and the stat block that
 * used to sit on the session list were the same question asked in two places;
 * this is the one place.
 *
 * INVARIANT: every number below is computed by src/metrics or src/gamification,
 *            never by a model — CLAUDE.md #1. This page only formats them.
 */
export default async function HubPage() {
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

  const fourWeeks = adherence(history.workouts, { start: addDays(today, -27), end: today });
  const streak = currentStreak(history.workouts, today);
  const nextMilestone = STREAK_MILESTONES.find((m) => m > streak) ?? null;
  const load = acwr(history.sets, today);
  const weekly = [...tonnageByWeek(history.sets).entries()];
  const thisWeek = weekly.at(-1);
  const peak = Math.max(...weekly.map(([, v]) => v), 1);

  const topLifts = [...exerciseBests(history.sets).values()]
    .filter((b) => b.bestE1rm !== null)
    .sort((a, b) => b.bestE1rm! - a.bestE1rm!)
    .slice(0, 5);

  const spentPct = Math.min(100, Math.round((xp.thisWeek / xp.ceiling) * 100));
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

      {/* Ranks 1 and 2. The grid gives the first two a full row each, which is
          the ranking made visible — adherence and streak are the mechanic. */}
      <div className="grid cols-4">
        <div className="stat">
          <div className="label with-hint">
            Adherence · 4 wks
            <FieldHint title="Adherence">
              Sessions you kept, out of those that have come due in the last four weeks. A scheduled
              rest day counts as kept — resting on plan is following it. Sessions still in the
              future count neither way.
            </FieldHint>
          </div>
          <div className="value">
            {fourWeeks.rate === null ? '—' : `${Math.round(fourWeeks.rate * 100)}%`}
          </div>
          <div className="muted small">
            {fourWeeks.kept} of {fourWeeks.resolved} sessions
          </div>
        </div>

        <div className="stat">
          <div className="label with-hint">
            Streak
            <FieldHint title="Streak">
              Planned sessions kept in a row, counting back from today. Rest days keep it alive; a
              skipped session breaks it. Days with nothing scheduled are stepped over, so training
              every other day does not reset it.
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
          <div className="label with-hint">
            XP this week
            <FieldHint title="Weekly XP">
              XP comes from adherence — keeping the sessions you planned — and never from how much
              you lifted. Volume-scaled XP would pay you to overtrain. Each session in a week is
              worth a little less than the one before, and the week is capped.
            </FieldHint>
          </div>
          <div className="value">{xp.thisWeek}</div>
          <div className="muted small">{xp.lifetime.toLocaleString()} lifetime</div>
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

      {/* Rank 4 — diagnostics. Below the game on purpose: these are numbers you
          consult when something feels wrong, not ones you open the app for. */}
      <h2 className="section">Training load</h2>
      <div className="grid cols-2">
        <div className="stat">
          <div className="label with-hint">
            This week
            <FieldHint title="Tonnage">
              Total load moved: weight × reps, warm-ups excluded. Bodyweight movements count as zero
              — there is no external load to measure, and estimating it would rewrite your past
              numbers every time your weight changed.
            </FieldHint>
          </div>
          <div className="value">{thisWeek ? kg(thisWeek[1]) : '—'}</div>
          <div className="muted small">{kg(totalTonnage(history.sets))} all time</div>
        </div>

        <div className="stat">
          <div className="label with-hint">
            Acute : chronic
            <FieldHint title="Acute : chronic">
              Your last 7 days of load divided by your last 28. Near 1.0 is steady, below 0.8 is a
              deload, and above 1.5 is a sharp spike — the range most associated with injury. Blank
              until a full 28 days sits behind you, because before that the number is meaningless.
            </FieldHint>
          </div>
          <div className="value">{load.ratio === null ? '—' : load.ratio.toFixed(2)}</div>
          <div className="muted small">
            {load.ratio === null
              ? `${load.chronicDaysCovered}/28 days of history`
              : acwrBand(load.ratio).replace('-', ' ')}
          </div>
        </div>
      </div>

      <h2 className="section with-hint">
        Weekly tonnage
        <FieldHint title="Weekly tonnage">
          Load moved per week, Monday to Sunday. The bar is scaled against your heaviest week, so it
          shows the shape of your training rather than an absolute amount.
        </FieldHint>
      </h2>
      <div className="card tonnage">
        {weekly.slice(-12).map(([week, value]) => (
          <div key={week} className="tonnage-row">
            <span className="muted small">{displayShortDate(week)}</span>
            <span className="bar">
              <span style={{ width: `${(value / peak) * 100}%` }} />
            </span>
            <span className="small tonnage-value">{kg(value)}</span>
          </div>
        ))}
        {weekly.length === 0 ? <p className="muted small">No sets logged yet.</p> : null}
      </div>

      <h2 className="section with-hint">
        Best estimated 1RM
        <FieldHint title="Estimated 1RM">
          What your best set suggests you could lift once, using the Epley formula: weight × (1 +
          reps ÷ 30). It is an estimate, not a test. Left blank above 12 reps, where the formula
          stops being trustworthy.
        </FieldHint>
      </h2>
      <div className="card">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Lift</th>
              <th>e1RM</th>
              <th>Best set</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {topLifts.map((b) => (
              <tr key={b.exerciseId}>
                <td data-label="Lift">
                  {history.exercises.get(b.exerciseId)?.name ?? b.exerciseId}
                </td>
                <td data-label="e1RM">{b.bestE1rm!.toFixed(1)} kg</td>
                <td data-label="Best set" className="muted">
                  {b.bestWeightKg} kg
                </td>
                <td data-label="When" className="muted small">
                  {displayDate(b.bestE1rmDate)}
                </td>
              </tr>
            ))}
            {topLifts.length === 0 ? (
              <tr>
                <td data-label="" colSpan={4} className="muted small">
                  Nothing estimable yet — Epley needs a loaded set of 12 reps or fewer.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
