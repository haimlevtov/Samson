import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { loadEvidence, type EvidenceGrade, type EvidenceRow } from '@/src/db/evidence';
import { FieldHint } from '@/src/ui/FieldHint';
import { EvidenceBody } from '@/src/ui/EvidenceCard';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Supplements — Samson' };

/**
 * One row, rendered by the shared component in src/ui/EvidenceCard.tsx.
 *
 * WHY it moved: the coach's supplement panel needs the same row, and its first
 * copy of this markup already dropped the grade LABEL — leaving a bare letter,
 * which the .evidence-grade rule in globals.css calls out as the thing not to
 * do. Two copies of a health-claim card is one copy too many.
 */
function EvidenceCard({ row }: { row: EvidenceRow }) {
  return (
    <li className="card evidence-row">
      <EvidenceBody row={row} />
    </li>
  );
}

/**
 * The supplement evidence table — ADR 0023.
 *
 * INVARIANT: content lives in the database — CLAUDE.md #7. Every claim, grade,
 *            dose and citation on this page is a row. Nothing here is written in
 *            code except the labels for the grades, which now live in
 *            `src/ui/EvidenceCard.tsx` because the coach renders the same rows.
 *
 * Phase 6 gave the rows a second entry point: the supplement panel on `/coach`
 * asks a question and shows ONE row, verbatim, through the same component. This
 * page is still the way to read all of them, and both links come from Coach.
 *
 * AI-NOTE: a sub-route reached from Coach, deliberately not a sixth tab — five
 *          is the budget ADR 0012 set, and `/settings` and `/progression-trees`
 *          are the precedents. Both links into it are on Coach, so `OWNED_BY` in
 *          src/ui/tabs.ts must carry it or the orphan-link guard in
 *          tests/unit/invariants.test.ts cannot see this page.
 */
export default async function EvidencePage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const { rows, dropped } = await loadEvidence(db);

  const byGrade = (grade: EvidenceGrade) => rows.filter((row) => row.grade === grade).length;

  return (
    <>
      {/*
       * `header.top` and `.chip`, which is what every other sub-route uses —
       * app/progression-trees/page.tsx is the direct precedent.
       *
       * FOUND IN REVIEW: this shipped with `.page`, `.page-head` and
       * `.btn.ghost`, none of which exist in app/globals.css. The header had no
       * layout at all and the link was a bare 20px anchor, against the 44px
       * minimum in mobile-interface.md §3 — and a browser check that measured
       * overflow and read the text could not see it.
       */}
      <header className="top">
        <div>
          <h1>Supplements</h1>
          <span className="muted small">
            {rows.length} claims, {byGrade('A')} well established, {byGrade('D')} not supported
          </span>
        </div>
        <Link href="/coach" className="chip">
          Coach
        </Link>
      </header>

      {/*
       * The honesty ADR 0023 requires, where a user can see it rather than only
       * in a document they will never open. The ADR's "what is NOT verified"
       * section is this paragraph's source.
       */}
      <div className="card">
        <p className="small">
          <strong>Read the papers before you act on this.</strong>{' '}
          <FieldHint title="How this table was checked">
            Every DOI here was resolved against the DOI registry, and every claim was written from
            the paper&apos;s abstract. Nobody has read the full texts. A citation proves a paper
            exists and is on the right subject; it does not prove the paper puts its conclusion as
            strongly as the sentence above it does.
          </FieldHint>
        </p>
        <p className="muted small">
          This is a demonstration of how a supplement table could be sourced, not medical advice.
          Talk to a professional about anything you intend to take.
        </p>
      </div>

      {dropped > 0 && (
        /*
         * `loadEvidence` drops a row that fails validation rather than rendering
         * a half-parsed health claim, and logs the slug server-side for whoever
         * can fix it. This is the reader's half: silence would make a content
         * bug look like a shorter table — mobile-interface.md §4 forbids
         * "nothing happens".
         */
        <p className="muted small">
          {dropped} row{dropped === 1 ? '' : 's'} could not be displayed and{' '}
          {dropped === 1 ? 'is' : 'are'} missing from this list.
        </p>
      )}

      {rows.length === 0 ? (
        /*
         * NOT "nothing here yet" — FOUND IN REVIEW. These are shared rows from a
         * migration and there is no authoring feature, so there is no future in
         * which content arrives. Zero rows means the migration did not run, the
         * read policy changed, or every row failed validation. A polite "come
         * back later" would hide all three, which is the failure app/hub's own
         * comment names: a permission regression that looks exactly like an
         * unpopulated feature is one nobody would ever notice.
         */
        <div className="card">
          <p className="muted">
            The evidence table did not load. This is a fault rather than an empty list — the rows
            ship with the app.
          </p>
        </div>
      ) : (
        <ul className="evidence-list">
          {rows.map((row) => (
            <EvidenceCard key={row.slug} row={row} />
          ))}
        </ul>
      )}
    </>
  );
}
