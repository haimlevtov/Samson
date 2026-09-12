'use client';

import { useActionState } from 'react';
import { WEB_PLAN_MAX_BLOCK_WEEKS } from '@/src/llm/config';
import {
  GOAL_LABEL,
  JOINT_LABEL,
  PLAN_DAYS_PER_WEEK,
  REPORTABLE_JOINTS,
} from '@/src/planner/request';
import { trainingGoalSchema } from '@/src/planner/schema';
import { requestPlan } from './actions';
import { EMPTY_PLAN, type PlanOutcome, type PlanState } from './plan-state';

/** Derived from the schema, so a fifth goal renders without being listed here. */
const GOALS = trainingGoalSchema.options;

const WEEK_CHOICES = Array.from({ length: WEB_PLAN_MAX_BLOCK_WEEKS }, (_, i) => i + 1);

/**
 * What each outcome says. Code's words, every one of them — ADR 0027 §4 and
 * `docs/specs/mobile-interface.md` §4: a spinner that stops is not a state.
 *
 * `accepted` has a sentence too, and it did not at first. The block is a
 * `plan_runs` row that the page re-reads after `revalidatePath`, so the plan
 * itself is the real success state — but leaving this branch empty made the
 * whole outcome depend on a cache rule holding, and if it ever did not the user
 * would see the press do nothing at all. FOUND IN REVIEW.
 */
const SAID: Record<Exclude<PlanOutcome, 'idle'>, string> = {
  accepted: 'Your plan is ready — it is below.',
  rejected_rules:
    'The plan it wrote broke the safety rules, so it was not accepted. Pressing again asks for a different one — the rules are arithmetic rather than opinion, and they do not negotiate.',
  rejected_critic:
    'A second model read the plan and would not approve it. That is the check working rather than a bug. Try again.',
  exhausted:
    'It did not reach a plan the rules would accept in the attempt it had. This page gets one attempt per press, so try again.',
  failed: 'That did not finish.',
  'no-equipment':
    'The planner can only choose exercises you can actually do, and there is nothing on record about your equipment yet.',
  invalid: 'Those answers did not add up to a request.',
  'already-running':
    'A plan is already being written for you, or one just was. Give it a minute and reload this page — a second attempt would cost you twice for the same thing.',
};

/**
 * Ask for a plan — rework PR 8b, ADR 0027.
 *
 * WHY this exists at all, given `docs/specs/coach-chat.md` §1 argued against it:
 * a stakeholder decision, taken with the limits named. The limits are real and
 * the ADR states them — one iteration, one attempt, a four-week ceiling, and a
 * deadline that can expire mid-generation — so **pressing this does not
 * guarantee a plan.** Every way it can fail says so in words rather than leaving
 * a spinner behind.
 *
 * The four questions are the four `ContextInput` fields the app cannot read for
 * itself. Equipment is not among them: it is filtered in SQL before the model
 * sees anything (CLAUDE.md #5) and arrives as pre-filtered candidates.
 *
 * Nothing here is a control. The rules and the critic run on the server inside
 * the planner loop; this component posts four answers and renders a result.
 */
export function PlanRequestForm() {
  const [state, formAction, pending] = useActionState<PlanState, FormData>(requestPlan, EMPTY_PLAN);

  return (
    <div className="card">
      <h2 className="section">No plan yet</h2>

      <p className="muted">
        A plan is written by one model, checked against deterministic safety rules, and then read by
        a second model before you ever see it. Answer four questions and it will try.
      </p>

      <form action={formAction} className="settings-form">
        <label>
          <span className="label">What are you training for?</span>
          <select name="goal" defaultValue="general-fitness" disabled={pending}>
            {GOALS.map((goal) => (
              <option key={goal} value={goal}>
                {GOAL_LABEL[goal] ?? goal}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="label">Days a week</span>
          {/*
           * Derived from the schema's own bound, never re-typed — FOUND IN
           * REVIEW, and it was the one control here that listed its options by
           * hand. The range is tighter than the planner schema's 1 to 7: one day
           * is not a block and seven leaves no rest day, which the rules reject
           * anyway.
           */}
          <select name="days_per_week" defaultValue="3" disabled={pending}>
            {PLAN_DAYS_PER_WEEK.map((days) => (
              <option key={days} value={days}>
                {days}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="label">How many weeks</span>
          {/*
           * Capped at the WEB maximum, not the schema's. Generation time scales
           * with output tokens and nothing else here moves the deadline, so a
           * control offering eight weeks would be a control that could ask to be
           * killed mid-call — ADR 0027 §3.
           */}
          <select
            name="block_weeks"
            defaultValue={String(WEB_PLAN_MAX_BLOCK_WEEKS)}
            disabled={pending}
          >
            {WEEK_CHOICES.map((weeks) => (
              <option key={weeks} value={weeks}>
                {weeks}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="joint-set">
          <legend className="label">Anything sore? (optional)</legend>
          {/*
           * Checkboxes over the seven joints `JOINT_LOADING` knows, never free
           * text: `loadsJoint` returns false for a joint it does not recognise —
           * deliberately, so a stray value cannot fail every plan a user gets —
           * which means a typed joint would silently protect nothing.
           */}
          {REPORTABLE_JOINTS.map((joint) => (
            <label key={joint} className="check-row">
              <input type="checkbox" name="injured_joints" value={joint} disabled={pending} />
              <span>{JOINT_LABEL[joint] ?? joint}</span>
            </label>
          ))}
          <p className="muted small">
            The planner is told to leave these alone, and the rules reject a plan that loads one
            anyway.
          </p>
        </fieldset>

        <div className="settings-submit">
          <button type="submit" disabled={pending}>
            {pending ? 'Writing a plan…' : 'Create a plan'}
          </button>
        </div>
      </form>

      {pending ? (
        <p className="muted small" role="status">
          {/*
           * FOUND IN REVIEW: this said leaving the page cancels the run, and it
           * does not. A server action is not aborted by navigation — it runs to
           * completion, spends what it spends, and writes its row. Telling the
           * user otherwise invited them to leave, assume nothing happened, and
           * pay for a second run.
           */}
          This takes most of a minute: one model writes the block, the rules check every number in
          it, and a second model reads it before anything is saved. Leaving the page loses the
          result, not the run — an accepted plan will be here when you come back.
        </p>
      ) : null}

      {state.outcome !== 'idle' ? (
        <div className="card" role="status">
          <p>{SAID[state.outcome]}</p>

          {/*
           * Only the planner loop's own constants reach here — the action maps
           * everything else to null, because a gateway message embeds up to 500
           * characters of upstream response body.
           */}
          {state.error !== null ? <p className="muted small">{state.error}</p> : null}

          {state.rejectionCount > 0 ? (
            <p className="muted small">
              {/*
               * FOUND IN REVIEW: this said "and the Hub tab lists them". Nothing
               * in the app reads `plan_runs.rejections` — the Hub's rejected
               * list is the challenge validator's, a different table — so the
               * card was sending the user to a page that does not exist.
               */}
              {state.rejectionCount} {state.rejectionCount === 1 ? 'finding was' : 'findings were'}{' '}
              recorded against it.
            </p>
          ) : null}

          {state.outcome === 'no-equipment' ? (
            <p className="muted small">
              Nothing you can do about this from here yet — it needs an equipment list, which the
              app does not collect.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
