'use client';

import { useActionState } from 'react';
import { MAX_DIET_QUESTION_CHARS } from '@/src/llm/config';
import { EvidenceBody } from '@/src/ui/EvidenceCard';
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
              placeholder="Does it actually do anything?"
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

        {/*
         * The SAME component `/evidence` renders — src/ui/EvidenceCard.tsx.
         *
         * FOUND IN REVIEW: this was a copy, and it had already dropped the grade
         * LABEL on its first outing, leaving a bare letter. `app/globals.css`
         * states the invariant on the `.evidence-grade` rule itself — state is
         * never carried by colour alone — and only A and D are tinted, so a B or
         * C row rendered as a lone grey character. Two copies of a health-claim
         * card is one copy too many.
         */}
        {row !== null ? (
          <div className="card evidence-row">
            <EvidenceBody row={row} />
          </div>
        ) : null}

        {state.message !== null ? (
          <p className="muted">
            {state.message} <a href="/evidence">the whole table is here</a>.
          </p>
        ) : null}
        {state.error !== null ? <p className="error small">{state.error}</p> : null}
      </div>
    </details>
  );
}
