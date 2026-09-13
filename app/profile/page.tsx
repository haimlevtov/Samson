import type { CSSProperties } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser, localDateFor } from '@/src/db/server';
import { loadHistory } from '@/src/db/training';
import { loadBadgeCatalogue, loadXpSummary } from '@/src/db/gamification';
import { loadComparisonObjects } from '@/src/db/comparisons';
import { acwr, acwrBand } from '@/src/metrics/acwr';
import { adherence, currentStreak } from '@/src/metrics/adherence';
import { addDays } from '@/src/metrics/dates';
import { exerciseBests } from '@/src/metrics/pr';
import { tonnageByWeek, tonnageForWeekOf, totalTonnage } from '@/src/metrics/tonnage';
import { compareTonnage } from '@/src/metrics/comparisons';
import { levelProgress, xpForLevel } from '@/src/gamification/level';
import { STREAK_MILESTONES } from '@/src/gamification/xp';
import { comparisonPhrase, displayDate, displayShortDate } from '@/src/ui/format';
import { FieldHint } from '@/src/ui/FieldHint';
import { Hex } from '@/src/ui/Hex';
import { Icon } from '@/src/ui/icons';
import { SegmentMeter } from '@/src/ui/SegmentMeter';
import { badgeIcon, metalFor } from '@/src/ui/tiers';

export const dynamic = 'force-dynamic';

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;

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
 * Settings are their own route, reached by the cog in the header — ADR 0013's
 * amendment, which followed from that same length: a control at the foot of the
 * longest page in the app is a scroll target rather than a control.
 *
 * INVARIANT: every number below is computed by src/metrics or src/gamification,
 *            never by a model — CLAUDE.md #1. This page only formats them.
 */
export default async function ProfilePage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const today = localDateFor(user.timezone);
  const [history, xp, catalogue, comparisonObjects] = await Promise.all([
    loadHistory(db),
    loadXpSummary(db, today),
    /*
     * The catalogue rather than only what is held — the Quest Log's locked
     * slots. ADR 0033 §5: through the SAME reader `/badges` uses, so a locked
     * hidden badge never reaches this page and the humour ceiling applies to an
     * unearned name here exactly as it does there.
     */
    loadBadgeCatalogue(db, user.id),
    loadComparisonObjects(db),
  ]);
  const badges = catalogue.earned;
  const hiddenHeld = badges.filter((b) => b.hidden).length;

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
  const allTime = totalTonnage(history.sets);
  const comparison = compareTonnage(allTime, comparisonObjects);
  const weekly = [...tonnageByWeek(history.sets).entries()];
  const thisWeek = tonnageForWeekOf(history.sets, today);
  const peak = Math.max(...weekly.map(([, v]) => v), 1);

  const topLifts = [...exerciseBests(history.sets).values()]
    .filter((b) => b.bestE1rm !== null)
    .sort((a, b) => b.bestE1rm! - a.bestE1rm!)
    .slice(0, 5);

  const spentPct = Math.min(100, Math.round((xp.thisWeek / xp.ceiling) * 100));

  return (
    <>
      <header className="top">
        <div>
          <h1>{user.displayName ?? 'Your profile'}</h1>
          <span className="muted small">{user.email}</span>
        </div>

        {/*
         * The only route to /settings — ADR 0013's amendment. In the header
         * rather than at the foot of the page, because this is the longest page
         * in the app and a control below all of it is a scroll target.
         *
         * .icon-btn is the project's icon-only control — the same primitive the
         * session screen's chart and edit links use — rather than a fifth
         * hand-rolled copy of its five declarations.
         *
         * aria-label rather than a visible word: the glyph is the whole target,
         * and an icon button with no accessible name is unusable with a screen
         * reader. title gives the same string to a pointer user.
         */}
        <Link href="/settings" className="icon-btn" aria-label="Settings" title="Settings">
          <Icon name="settings" size={18} />
        </Link>
      </header>

      {/*
       * The hero — the Quest Log. Every figure here comes from `levelProgress`
       * and `xpForLevel`, the curve's own functions, so the ring and the words
       * beside it cannot disagree — the spec's agreement property.
       */}
      <div className="card level-hero">
        <div
          className="level-ring"
          role="img"
          aria-label={`${level.intoLevel} of ${level.span} XP into level ${level.level}`}
          style={{ '--pct': `${levelPct}%` } as CSSProperties}
        >
          <span className="level-ring-disc">
            <Hex size={62}>
              <span className="display level-digit">{level.level}</span>
            </Hex>
          </span>
        </div>
        <div className="level-words">
          <div className="kicker with-hint">
            Level {level.level}
            <FieldHint title="Level">
              Read from your lifetime XP, so it is never stored and never out of date. Each level
              costs a quarter more than the one before — a linear curve would make level 30 as far
              from 29 as 2 is from 1, and the number would stop meaning anything.
            </FieldHint>
          </div>
          <div className="display level-next">
            {level.toNext.toLocaleString()} XP to Level {level.level + 1}
          </div>
          <p className="muted small">
            {level.intoLevel.toLocaleString()} of {level.span.toLocaleString()} into this level ·{' '}
            {levelPct}%
          </p>
          <p className="label-chips">
            <span className="chip">{xp.lifetime.toLocaleString()} XP lifetime</span>
            <span className="chip">
              Level {level.level + 1} at {xpForLevel(level.level + 1).toLocaleString()}
            </span>
          </p>
        </div>
      </div>

      {/*
       * Four equal tiles, two by two — the Quest Log. Order is still the ranking
       * — mobile-interface.md §2: streak and adherence are the mechanic the
       * product retains people with (invariant #4), and a lifetime session count
       * is vanity and sorts below them. What changed is that they no longer
       * differ in size.
       */}
      <div className="stat-grid">
        <div className="stat">
          <div className="stat-head">
            <div className="label with-hint">
              Streak
              <FieldHint title="Streak">
                Planned sessions kept in a row, counting back from today. Rest days keep it alive; a
                skipped session breaks it. Days with nothing scheduled are stepped over, so training
                every other day does not reset it.
              </FieldHint>
            </div>
            <span className="stat-plate">
              <Icon name="flame" />
            </span>
          </div>
          <div className="value display">{streak}</div>
          <div className="muted small">
            {nextMilestone === null
              ? 'every milestone earned'
              : `${nextMilestone - streak} to ${nextMilestone}`}{' '}
            · rest days keep it alive
          </div>
        </div>

        <div className="stat">
          <div className="stat-head">
            <div className="label with-hint">
              Adherence · 4 wks
              <FieldHint title="Adherence">
                Sessions you kept, out of those that have come due in the last four weeks. A
                scheduled rest day counts as kept — resting on plan is following it. Sessions still
                in the future count neither way.
              </FieldHint>
            </div>
            <span className="stat-plate">
              <Icon name="target" />
            </span>
          </div>
          <div className="value display">
            {fourWeeks.rate === null ? '—' : `${Math.round(fourWeeks.rate * 100)}%`}
          </div>
          <div className="muted small">
            {fourWeeks.kept} of {fourWeeks.resolved} sessions kept
          </div>
        </div>

        <div className="stat">
          <div className="stat-head">
            <div className="label">Sessions</div>
            <span className="stat-plate">
              <Icon name="dumbbell" />
            </span>
          </div>
          <div className="value display">{completed}</div>
          <div className="muted small">
            {first ? `since ${displayDate(first.localDate)}` : 'nothing logged yet'}
          </div>
        </div>

        <div className="stat">
          <div className="stat-head">
            <div className="label">Badges</div>
            <span className="stat-plate">
              <Icon name="medal" />
            </span>
          </div>
          <div className="value display">{badges.length}</div>
          <div className="muted small">
            unlocked{hiddenHeld > 0 ? ` · ${hiddenHeld} of them hidden` : ''}
          </div>
        </div>
      </div>

      <h2 className="section with-hint">
        <Icon name="sparkles" size={14} />
        This week&rsquo;s XP
        <FieldHint title="Weekly XP">
          XP comes from adherence — keeping the sessions you planned — and never from how much you
          lifted. Volume-scaled XP would pay you to overtrain. Each session in a week is worth a
          little less than the one before, and past the cap more training earns nothing at all. The
          cap is enforced in the database as well as in the app, so no path can exceed it.
        </FieldHint>
      </h2>
      <div className="card">
        <div className="week-xp-head">
          <span>
            <span className="display week-xp-value">{xp.thisWeek}</span>{' '}
            <span className="muted">of {xp.ceiling}</span>
          </span>
          <span className="label">Weekly cap</span>
        </div>
        {/* Ten segments, each a tenth of the ceiling; the partial one is drawn
            as far as the week has reached. The label carries the figures. */}
        <SegmentMeter
          value={xp.thisWeek}
          total={xp.ceiling}
          count={10}
          label={`${xp.thisWeek} of ${xp.ceiling} XP earned this week`}
        />
        <p className="muted small">
          From kept sessions, never from load. Past the cap, more training earns nothing. {spentPct}
          % of this week&rsquo;s cap.
        </p>
      </div>

      {/*
       * The only route into the progression trees — ADR 0020, the same
       * arrangement ADR 0013's amendment made for /settings. Not a sixth tab:
       * five is the budget ADR 0012 set, and deleting this link strands the
       * page.
       *
       * Here rather than at the foot of the page for the reason ADR 0013 gives
       * about this page's length — a control below every chart is a scroll
       * target. It sits with Badges because both answer "what have I got".
       *
       * No rung count, which the handoff drew: it needs every logged set, and
       * this page does not otherwise read the trees — docs/plans/quest-log-redesign.md.
       */}
      <h2 className="section">
        <Icon name="route" size={14} />
        Progression
      </h2>
      <Link href="/progression-trees" className="card row-link">
        <Hex size={40} tone="soft">
          <Icon name="route" size={20} />
        </Hex>
        <span className="row-link-words">
          <strong>Progression trees</strong>
          <span className="muted small">push · pull · legs · core</span>
        </span>
        <Icon name="chevron-right" size={18} />
      </Link>

      <h2 className="section">
        <Icon name="medal" size={14} />
        Badges · {badges.length} earned
      </h2>
      {/*
       * The way into /badges — ADR 0017's 2026-09-12 amendment. Above the shelf
       * rather than below it, so it is there for somebody who has earned nothing
       * yet, which is exactly who needs to know what there is to earn.
       */}
      <Link href="/badges" className="card row-link">
        <strong>Every badge, and how to earn it</strong>
        <Icon name="chevron-right" size={18} />
      </Link>
      {badges.length === 0 ? (
        <p className="card muted">
          Nothing unlocked yet. Achievements come from consistency, not from a single heavy day.
        </p>
      ) : null}
      {badges.length + catalogue.toGet.length > 0 ? (
        <div className="medal-shelf">
          {badges.map((b) => {
            const metal = b.hidden ? 'obsidian' : metalFor(b.tier);
            return (
              <article
                key={b.slug}
                className={`card medal badge-linked${b.hidden ? ' medal-found' : ''}`}
              >
                <Hex size={64} tone={metal}>
                  <Icon name={badgeIcon(b.slug)} size={28} />
                </Hex>
                {/*
                 * A badge is what somebody taps expecting to learn about it, so
                 * each one opens its place in the catalogue. The NAME is the link
                 * — a short accessible name — and `.badge-linked` stretches its
                 * target over the card, so the whole card is still one tap.
                 */}
                <h3>
                  <Link href={`/badges#${b.slug}`}>{b.name}</Link>
                </h3>
                {/*
                 * A hidden badge is shown to the person who earned it and to
                 * nobody else — ADR 0017. "found" is the whole reward: without
                 * it a badge whose definition was secret arrives looking like any
                 * other. Said in words, not only in the obsidian.
                 */}
                <p className="medal-tier">{b.hidden ? 'hidden · found' : `${b.tier} · ${metal}`}</p>
              </article>
            );
          })}
          {/*
           * Locked slots: visible badges not yet earned, within the humour
           * setting — never a hidden one, which the catalogue never received.
           * Dashed and muted, with a lock as well as the missing colour, so the
           * state is not colour alone.
           */}
          {catalogue.toGet.map((badge) => (
            <article key={badge.slug} className="card medal medal-locked badge-linked">
              <Hex size={64} tone="plain">
                <Icon name="lock" size={24} />
              </Hex>
              <h3>
                <Link href={`/badges#${badge.slug}`}>{badge.name}</Link>
              </h3>
              <p className="medal-tier">
                {badge.tier} · {metalFor(badge.tier)}
              </p>
            </article>
          ))}
        </div>
      ) : null}
      <p className="muted small medal-foot">
        Hidden badges are not listed until you find one. Metal is a reading of the tier, not a new
        number.
      </p>

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
              {comparison !== null && (
                <>
                  {' '}
                  The comparison is approximate and rounded down to whole ones.{' '}
                  {/*
                   * The note is printed exactly as it was authored. An earlier
                   * version lowercased it to sit mid-sentence and turned two of
                   * the fourteen rows into "a modern london double-decker" and
                   * "a european supermini" — CLAUDE.md #7 covers the display
                   * form of a row as much as its value.
                   */}
                  {comparison.object.sourceNote}.
                </>
              )}
            </FieldHint>
          </div>
          {/*
           * WHY 0 kg and never an em dash — mobile-interface.md §4: the dash is
           * for a metric not yet computable, like the ratio before 28 days of
           * history. A week with nothing lifted yet has a figure, and it is zero;
           * the all-time line below prints 0 kg for a new user on the same
           * reasoning, and the coach is told 0 for the same week through the same
           * function (src/chat/facts.ts).
           */}
          <div className="value">{kg(thisWeek)}</div>
          <div className="muted small">{kg(allTime)} all time</div>
          {/*
           * The one place in this app where a number is allowed to stop being a
           * number. Nobody has an intuition for 140,000 kg.
           *
           * Absent rather than approximated below the lightest object in the
           * table — `compareTonnage` returns null there, because "about half a
           * cat" is both wrong and a strange thing to tell somebody three sets
           * into their first session.
           *
           * The row's source_note goes in the Tonnage hint above rather than a
           * `title` attribute. FieldHint's own doc comment gives the reason it
           * is a real focusable button rather than a hover target: "hover does
           * not exist on a phone, and this app is used in a gym." A `title` on
           * a non-interactive span is worse still — it reaches neither a
           * keyboard nor a touch device.
           */}
          {comparison !== null && (
            <div className="muted small">about {comparisonPhrase(comparison)}</div>
          )}
        </div>
      </div>

      <h2 className="section with-hint">
        Weekly tonnage
        <FieldHint title="Weekly tonnage">
          Load moved per week, Monday to Sunday. The bar is scaled against your heaviest week, so it
          shows the shape of your training rather than an absolute amount.
        </FieldHint>
      </h2>
      {/*
       * Not "no sets logged": a bodyweight-only lifter has logged plenty, and
       * this branch is reached whenever no working set carries external load.
       */}
      {weekly.length === 0 ? (
        <p className="card muted">
          Nothing to chart yet — tonnage needs a loaded working set, so warm-ups and bodyweight work
          count as zero.
        </p>
      ) : (
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

      <h2 className="section with-hint">
        Best estimated 1RM
        <FieldHint title="Estimated 1RM">
          Epley&rsquo;s formula — weight × (1 + reps ÷ 30) — over your heaviest qualifying set.
          Warm-ups never count, and sets above twelve reps are excluded: the estimate stops being
          meaningful there.
        </FieldHint>
      </h2>
      {topLifts.length === 0 ? (
        <p className="card muted">
          Nothing estimable yet — Epley needs a loaded set of 12 reps or fewer.
        </p>
      ) : (
        <div className="card table-scroll">
          {/* table-cards, not a bare table: below 760px each row becomes a card
              using these data-labels, which is what keeps the page from
              scrolling sideways — mobile-interface.md §3. */}
          <table className="table-cards">
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
                  <td data-label="Lift">
                    {history.exercises.get(best.exerciseId)?.name ?? 'Unknown lift'}
                  </td>
                  <td data-label="e1RM">
                    {best.bestE1rm === null ? '—' : `${best.bestE1rm.toFixed(1)} kg`}
                  </td>
                  <td data-label="When">
                    {best.bestE1rmDate ? displayShortDate(best.bestE1rmDate) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
