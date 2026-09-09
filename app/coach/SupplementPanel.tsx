'use client';

import { useActionState } from 'react';
import { MAX_DIET_QUESTION_CHARS } from '@/src/llm/config';
import { doiUrl } from '@/src/evidence/doi';
import { askAboutSupplement } from './actions';
import { EMPTY_SUPPLEMENT, type SupplementState } from './supplement-state';

/**
 * Ask about a supplement, get the row.
 *
 * INVARIANT: every word below comes from `supplement_evidence` or from a
 *            constant in `src/diet/supplements.ts`. The model's whole output is
 *            a slug — it has no text field — so there is nothing it wrote that
 *            could render here. ADR 0023, `docs/PRD.md` §5.7.
 *
 * WHY the answer is not a summary: a summary is a new claim, and ADR 0023 is
 * explicit that nobody on this project has read the full text behind these rows.
 * A D-graded row, where the evidence does NOT support the popular claim, is
 * exactly the one a fluent paraphrase would soften.
 *
 * This deliberately renders the same fields as `/evidence` — the grade, the
 * claim, the dose, the caution and the clickable citation — because a reader
 * being able to check the row is the whole argument of that ADR, and an answer
 * that dropped the citation would be the paraphrase by another route.
 */
export function SupplementPanel() {
  const [state, formAction, pending] = useActionState<SupplementState, FormData>(
    askAboutSupplement,
    EMPTY_SUPPLEMENT
  );

  const row = state.row;
  const href = row === null ? null : doiUrl(row.doi);

  return (
    <details className="plan-disclosure card">
      <summary>
        <span className="label">Supplements</span>
        <span className="muted small">Answered from the evidence table</span>
      </summary>

      <div className="plan-body">
        <form action={formAction} className="settings-form">
          <label>
            <span className="label">Ask about one</span>
            <input
              name="question"
              type="text"
              maxLength={MAX_DIET_QUESTION_CHARS}
              defaultValue={state.question}
              placeholder="Does creatine actually do anything?"
              autoComplete="off"
            />
          </label>

          <div className="settings-submit">
            <button type="submit" disabled={pending}>
              {pending ? 'Looking it up…' : 'Look it up'}
            </button>
          </div>
        </form>

        {!state.asked && state.error === null ? (
          <p className="muted small">
            The coach does not have an opinion about supplements. It looks your question up in a
            small curated table and shows you the row, in the row&apos;s own words, with the paper
            it came from. <a href="/evidence">Supplements</a> lists all of them.
          </p>
        ) : null}

        {row !== null ? (
          <div className="card evidence-row">
            <div className="evidence-head">
              <h3>{row.supplement}</h3>
              <span className={`evidence-grade is-${row.grade.toLowerCase()}`}>
                <strong>{row.grade}</strong>
              </span>
            </div>

            <p className="evidence-claim">{row.claim}</p>

            {row.dose !== null ? (
              <p className="muted small">
                <span className="label inline">Dose</span> {row.dose}
              </p>
            ) : null}

            {row.caution !== null ? (
              <p className="muted small evidence-caution">
                <span className="label inline">Worth knowing</span> {row.caution}
              </p>
            ) : null}

            {/*
             * The citation is a link for the reason ADR 0023 gives: a reader who
             * cannot check the row is being asked to take it on trust, which is
             * the thing the table exists not to ask. `href` is null only for a
             * DOI that is not one, which `loadEvidence` already refuses to
             * return.
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
          </div>
        ) : null}

        {state.message !== null ? <p className="muted">{state.message}</p> : null}
        {state.error !== null ? <p className="error small">{state.error}</p> : null}
      </div>
    </details>
  );
}
