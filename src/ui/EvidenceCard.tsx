/**
 * One supplement evidence row, rendered the same way wherever it appears.
 *
 * INVARIANT: state is never carried by colour alone — `docs/specs/mobile-interface.md`
 *            §3, and `app/globals.css` says it on the `.evidence-grade` rule
 *            itself. The chip prints its letter AND its meaning; the colour is
 *            the fast path, never the only one.
 *
 * FOUND IN REVIEW: the coach's supplement panel copied this markup and dropped
 * `GRADE_LABEL` on the way, so a B or C row rendered as a lone grey letter — no
 * word, and no colour either, since only A and D are tinted. The copy had
 * already drifted on its first outing, which is the argument for this file
 * existing rather than for a careful second copy.
 *
 * INVARIANT: content lives in the database — CLAUDE.md #7. Every claim, grade,
 *            dose, caution and citation below is a column. Nothing about a
 *            supplement is written in code except the labels for the grades,
 *            which are this project's own reading of ADR 0023's definitions.
 */
import { doiUrl } from '../evidence/doi';
import type { EvidenceGrade, EvidenceRow } from '../db/evidence';

/**
 * What a grade means, in the reader's language.
 *
 * WHY the wording matters more than the letter: "C" tells a reader nothing on
 * its own, and a table of letters invites them to read A as "buy this" and
 * ignore the rest. ADR 0023's grade definitions, said in one line each.
 *
 * These four strings are the ones `/evidence` has shipped since phase 5 and are
 * moved here verbatim, not rewritten.
 */
const GRADE_LABEL: Record<EvidenceGrade, string> = {
  A: 'Well established',
  B: 'Established, narrowly',
  C: 'Mixed or limited',
  D: 'Not supported',
};

export function GradeChip({ grade }: { grade: EvidenceGrade }) {
  return (
    <span className={`evidence-grade is-${grade.toLowerCase()}`}>
      <strong>{grade}</strong> {GRADE_LABEL[grade]}
    </span>
  );
}

/**
 * The row's body. The element wrapping it differs — a list item on `/evidence`,
 * a plain block inside the coach's disclosure — so the caller supplies it.
 */
export function EvidenceBody({ row }: { row: EvidenceRow }) {
  const href = doiUrl(row.doi);

  return (
    <>
      <div className="evidence-head">
        <h3>{row.supplement}</h3>
        <GradeChip grade={row.grade} />
      </div>

      <p className="evidence-claim">{row.claim}</p>

      {row.dose !== null && (
        <p className="muted small">
          <span className="label inline">Dose</span> {row.dose}
        </p>
      )}

      {row.caution !== null && (
        <p className="muted small evidence-caution">
          <span className="label inline">Worth knowing</span> {row.caution}
        </p>
      )}

      {/*
       * The citation is a link because the whole argument of ADR 0023 is that a
       * reader can check the row. A DOI they cannot click is a decoration — and
       * `.evidence-cite` is what gives it the 44px target that a 13px line of
       * text does not have on its own (mobile-interface.md §3).
       *
       * `href` is null only if a row reached here with a DOI that is not one,
       * which `loadEvidence` already refuses to return. Rendered as plain text
       * rather than as a dead link if it ever happens.
       */}
      {href === null ? (
        <p className="muted small">
          {row.sourceTitle} ({row.sourceYear})
        </p>
      ) : (
        <p className="muted small evidence-cite">
          <a href={href} target="_blank" rel="noreferrer noopener">
            {row.sourceTitle} ({row.sourceYear})
          </a>
        </p>
      )}
    </>
  );
}
