import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { loadBadgeCatalogue } from '@/src/db/gamification';
import { hiddenLine } from '@/src/gamification/catalogue';
import { displayDate } from '@/src/ui/format';

export const dynamic = 'force-dynamic';

/**
 * Every badge, and how to earn it — rework PR 7, ADR 0017's 2026-09-12
 * amendment.
 *
 * INVARIANT: a hidden badge the user has not earned is a COUNT here and nothing
 *            else. That is enforced before this page runs — by the policy on
 *            `achievements` and by `hidden_achievements_remaining()` returning
 *            one integer — so no branch below can leak one by mistake.
 *
 * WHY earned comes first: a page that opens on everything you lack is a list of
 * failures, and the badge somebody just earned is the one they came to look at.
 *
 * AI-NOTE: a sub-route Profile owns, like `/progression-trees` — not a sixth
 *          tab. The Badges section on Profile is the way in; deleting its links
 *          strands the page, and `tests/unit/invariants.test.ts` fails if so.
 */
export default async function BadgesPage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const catalogue = await loadBadgeCatalogue(db, user.humorMaxLevel);
  const hidden = hiddenLine(catalogue);

  return (
    <>
      <header className="top">
        <div>
          <h1>Badges</h1>
          <span className="muted small">
            {catalogue.earned.length} earned · {catalogue.toGet.length} to get
          </span>
        </div>
        <Link href="/profile" className="chip">
          Profile
        </Link>
      </header>

      <h2 className="section">Earned</h2>
      {catalogue.earned.length === 0 ? (
        <p className="card muted">
          None yet. Everything below is how to get the first one — they come from turning up, not
          from a single heavy day.
        </p>
      ) : (
        <div className="badge-shelf">
          {catalogue.earned.map((badge) => (
            <article key={badge.slug} id={badge.slug} className="card badge-card">
              <h3>{badge.name}</h3>
              <p className="muted small">{badge.description}</p>
              <p className="muted small">
                <span className="chip chip-on">{badge.tier}</span>
                {/* The same marker Profile uses — see the comment there. */}
                {badge.hidden && <span className="chip chip-found">found</span>} earned{' '}
                {displayDate(badge.earnedOn)}
              </p>
              {badge.sourceHint !== null && <p className="muted small">{badge.sourceHint}</p>}
            </article>
          ))}
        </div>
      )}

      <h2 className="section">To get</h2>
      {catalogue.toGet.length === 0 ? (
        <p className="card muted">Every badge on the list is yours.</p>
      ) : (
        <div className="badge-shelf">
          {catalogue.toGet.map((badge) => (
            <article key={badge.slug} id={badge.slug} className="card badge-card badge-locked">
              <h3>{badge.name}</h3>
              {/*
               * `how_to_earn`, not `description` — ADR 0017's amendment. The
               * description is written for somebody who already has the badge,
               * in the past tense, and two of them are not even the condition.
               */}
              <p className="small">{badge.howToEarn}</p>
              <p className="muted small">
                <span className="chip">{badge.tier}</span>
              </p>
            </article>
          ))}
        </div>
      )}

      {/*
       * A count, and nothing about which — the owner's decision of 2026-09-12.
       * Omitting these silently would teach people the list above is complete.
       */}
      {hidden !== null && <p className="card muted">{hidden}</p>}
    </>
  );
}
