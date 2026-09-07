import { redirect } from 'next/navigation';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { loadHistory } from '@/src/db/training';
import { loadUnlockedAchievements, loadXpSummary } from '@/src/db/gamification';
import { acwr, acwrBand } from '@/src/metrics/acwr';
import { adherence, currentStreak } from '@/src/metrics/adherence';
import { addDays } from '@/src/metrics/dates';
import { exerciseBests } from '@/src/metrics/pr';
import { tonnageByWeek, totalTonnage } from '@/src/metrics/tonnage';
import { levelProgress } from '@/src/gamification/level';
import { STREAK_MILESTONES } from '@/src/gamification/xp';
import { displayDate, displayShortDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';
import { signOut } from '../sign-in/actions';
import { SettingsForm } from './SettingsForm';

export const dynamic = 'force-dynamic';

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;

/**
 * Every timezone this runtime can resolve.
 *
 * WHY the whole list rather than a curated dozen: a curated list is a list of
 * the places the author thought of, and being absent from it means your streak
 * breaks at the wrong hour with no way to fix it. `Intl` already knows them.
 */
function knownTimezones(): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const zones = supported ? supported('timeZone') : [];
  return zones.length > 0 ? zones : ['UTC'];
}

/**
 * Profile — ADR 0013.
 *
 * You, and what you have earned. ADR 0012 originally put the game state on Hub
 * and left this page holding three settings; ADR 0013 moved the boundary,
 * because a badge is a thing you have rather than a statistic, and because Hub
 * needed to become the tab about other people.
 *
 * The page is long, and that was the argued cost of the decision: a long page
 * about one subject is scrolled, while a tab about two subjects is misnavigated.
 * Settings sit behind a disclosure so the page still opens on what you earned.
 *
 * INVARIANT: every number below is computed by src/metrics or src/gamification,
 *            never by a model — CLAUDE.md #1. This page only formats them.
 */
export default async function ProfilePage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const today = localDateFor(user.timezone);
  const [history, xp, badges] = await Promise.all([
    loadHistory(db),
    loadXpSummary(db, today),
    loadUnlockedAchievements(db),
  ]);

  const first = history.workouts[0];
  const completed = history.workouts.filter((w) => w.status === 'completed').length;

  // Every figure the level bar prints comes from this one call, so the bar and
  // the label beside it cannot disagree — the spec's agreement property.
  const level = levelProgress(xp.lifetime);
  const levelPct = Math.round((level.intoLevel / level.span) * 100);

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

  const zones = knownTimezones();
  // A stored zone this runtime does not list would otherwise vanish from the
  // select and be silently replaced on the next save.
  const timezones = zones.includes(user.timezone) ? zones : [user.timezone, ...zones];

  return (
    <>
      <header className="top">
        <div>
          <h1>{user.displayName ?? 'Your profile'}</h1>
          <span className="muted small">{user.email}</span>
        </div>
      </header>

      <div className="card level-card">
        <div className="level-head">
          <span className="level-badge" aria-hidden="true">
            {level.level}
          </span>
          <div>
            <div className="label with-hint">
              Level {level.level}
              <FieldHint title="Level">
                Read from your lifetime XP, so it is never stored and never out of date. Each level
                costs a quarter more than the one before — a linear curve would make level 30 as far
                from 29 as 2 is from 1, and the number would stop meaning anything.
              </FieldHint>
            </div>
            <div className="muted small">{level.toNext.toLocaleString()} XP to next level</div>
          </div>
        </div>
        <div
          className="xp-meter"
          role="img"
          aria-label={`${level.intoLevel} of ${level.span} XP into level ${level.level}`}
        >
          <span style={{ width: `${levelPct}%` }} />
        </div>
        <p className="muted small">
          {level.intoLevel.toLocaleString()} of {level.span.toLocaleString()} · {levelPct}%
        </p>
      </div>

      <div className="grid cols-4">
        <div className="stat">
          <div className="label">Sessions</div>
          <div className="value">{completed}</div>
          <div className="muted small">
            {first ? `since ${displayDate(first.localDate)}` : 'nothing logged yet'}
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
          {xp.thisWeek} of {xp.ceiling} · {spentPct}% · {xp.lifetime.toLocaleString()} lifetime
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

      <h2 className="section with-hint">
        Training load
        <FieldHint title="Acute : chronic">
          Your last 7 days of load divided by your last 28. Near 1.0 is steady, below 0.8 is a
          deload, and above 1.5 is a sharp spike — the range most associated with injury. Blank
          until a full 28 days sits behind you, because before that the number is meaningless.
        </FieldHint>
      </h2>
      <div className="grid cols-2">
        <div className="stat">
          <div className="label">Acute : chronic</div>
          <div className="value">{load.ratio === null ? '—' : load.ratio.toFixed(2)}</div>
          <div className="muted small">
            {load.ratio === null
              ? `${load.chronicDaysCovered}/28 days of history`
              : acwrBand(load.ratio).replace('-', ' ')}
          </div>
        </div>
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
      </div>

      {weekly.length > 0 && (
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
        </div>
      )}

      {topLifts.length > 0 && (
        <>
          <h2 className="section with-hint">
            Best estimated 1RM
            <FieldHint title="Estimated 1RM">
              Epley&rsquo;s formula over your heaviest qualifying set. Warm-ups never count, and
              sets above twelve reps are excluded — the estimate stops being meaningful there.
            </FieldHint>
          </h2>
          <div className="card table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Lift</th>
                  <th>e1RM</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {topLifts.map((best) => (
                  <tr key={best.exerciseId}>
                    <td>{history.exercises.get(best.exerciseId)?.name ?? 'Unknown lift'}</td>
                    <td>{best.bestE1rm === null ? '—' : `${best.bestE1rm.toFixed(1)} kg`}</td>
                    <td>{best.bestE1rmDate ? displayShortDate(best.bestE1rmDate) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/*
       * Settings behind a disclosure — ADR 0013.
       *
       * WHY <details> and not a modal: it is keyboard and screen-reader
       * navigable with no work, it needs no client state on a page that is
       * otherwise a server component, and with CSS off it degrades to an open
       * section rather than a button that does nothing.
       */}
      <details className="card settings-disclosure">
        <summary>
          <span className="cog" aria-hidden="true">
            ⚙
          </span>
          Settings
        </summary>

        <div className="settings-body">
          <SettingsForm
            displayName={user.displayName ?? ''}
            timezone={user.timezone}
            humorMaxLevel={user.humorMaxLevel}
            theme={user.theme}
            timezones={timezones}
          />

          <p className="muted small">
            Everything is shown in kilograms, and stored that way — CLAUDE.md #8. An imperial toggle
            lands when display conversion does; until then it would be a switch that changes no
            number on any screen.
          </p>

          <form action={signOut}>
            <button type="submit" className="secondary">
              Sign out
            </button>
          </form>
        </div>
      </details>
    </>
  );
}
