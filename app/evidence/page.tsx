import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createServerDb, currentUser } from '@/src/db/server';
import { loadEvidence, type EvidenceGrade, type EvidenceRow } from '@/src/db/evidence';
import { doiUrl } from '@/src/evidence/doi';
import { FieldHint } from '@/src/ui/FieldHint';

export const dynamic = 'force-dynamic';

/**
 * The supplement evidence table — ADR 0023.
 *
 * INVARIANT: content lives in the database — CLAUDE.md #7. Every claim, grade,
 *            dose and citation on this page is a row. Nothing here is written in
 *            code except the labels for the grades.
 *
 * AI-NOTE: a sub-route reached from Coach, deliberately not a sixth tab — five
 *          is the budget ADR 0012 set, and `/settings` and `/progression-trees`
 *          are the precedents. The link on Coach is the only way in, so
 *          `OWNED_BY` in src/ui/tabs.ts must carry it or the orphan-link guard
 *          in tests/unit/invariants.test.ts cannot see this page.
 */
export const metadata = { title: 'Supplements — Samson' };

/**
 * What a grade means, in the reader's language.
 *
 * WHY the wording matters more than the letter: "C" tells a reader nothing on
 * its own, and a table of letters invites them to read A as "buy this" and
 * ignore the rest. ADR 0023's grade definitions, said in one line each.
 */
const GRADE_LABEL: Record<EvidenceGrade, string> = {
  A: 'Well established',
  B: 'Established, narrowly',
  C: 'Mixed or limited',
  D: 'Not supported',
};

function GradeChip({ grade }: { grade: EvidenceGrade }) {
  return (
    <span className={`evidence-grade is-${grade.toLowerCase()}`}>
      {/*
       * INVARIANT: state is never carried by colour alone —
       *            docs/specs/mobile-interface.md §3. The letter and the words
       *            both say it, so the chip still works in greyscale.
       */}
      <strong>{grade}</strong> {GRADE_LABEL[grade]}
    </span>
  );
}

function EvidenceCard({ row }: { row: EvidenceRow }) {
  return (
    <li className="card evidence-row">
      <div className="evidence-head">
        <h3>{row.supplement}</h3>
        <GradeChip grade={row.grade} />
      </div>

      <p className="evidence-claim">{row.claim}</p>

      {row.dose !== null && (
        <p className="muted small">
          <span className="label">Dose</span> {row.dose}
        </p>
      )}

      {row.caution !== null && (
        <p className="muted small evidence-caution">
          <span className="label">Worth knowing</span> {row.caution}
        </p>
      )}

      <p className="muted small">
        {/*
         * The citation is a link because the whole argument of ADR 0023 is that
         * a reader can check the row. A DOI they cannot click is a decoration.
         */}
        <a href={doiUrl(row.doi)} target="_blank" rel="noreferrer noopener">
          {row.sourceTitle}
        </a>{' '}
        ({row.sourceYear})
      </p>
    </li>
  );
}

export default async function EvidencePage() {
  const db = await createServerDb();
  const user = await currentUser(db);
  if (!user) redirect('/sign-in');

  const { rows, dropped } = await loadEvidence(db);

  const byGrade = (grade: EvidenceGrade) => rows.filter((row) => row.grade === grade).length;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Supplements</h1>
        <Link className="btn ghost" href="/coach">
          Coach
        </Link>
      </header>

      <p className="muted small">
        {rows.length} claims, each with the paper behind it — {byGrade('A')} well established,{' '}
        {byGrade('D')} not supported by the evidence at all.
      </p>

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
         * a half-parsed health claim. Silence would make a content bug look like
         * an empty category — mobile-interface.md §4 forbids "nothing happens".
         */
        <p className="muted small">
          {dropped} row{dropped === 1 ? '' : 's'} could not be displayed and{' '}
          {dropped === 1 ? 'is' : 'are'} missing from this list.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="muted">Nothing here yet.</p>
      ) : (
        <ul className="evidence-list">
          {rows.map((row) => (
            <EvidenceCard key={row.slug} row={row} />
          ))}
        </ul>
      )}
    </main>
  );
}
