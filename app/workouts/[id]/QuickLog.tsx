'use client';

import { useActionState, useRef } from 'react';
import { confirmParsedSets, parseFreeText } from '../actions';
import { EMPTY_PARSE, type ParseState } from '../parse-state';

/**
 * Say what you did; confirm what it heard; then it writes.
 *
 * WHY two steps rather than one: the normalizer transcribes rather than
 * computes, but a transcription can still be wrong, and a wrong set silently
 * entering the log moves every metric downstream with nothing to show the user
 * why. The interpretation is the confirmation step, and it is not optional.
 *
 * WHY it is collapsed by default: open, it pushed "Log set" below the fold on a
 * 375x812 screen, and docs/specs/mobile-interface.md §2 ranks that action 1.
 * Free text is the faster path when it works, but it needs a key and a network
 * and the form always works — so the form keeps the fold and this is one tap
 * away.
 */
export function QuickLog({ workoutId }: { workoutId: string }) {
  const [state, parseAction, parsing] = useActionState<ParseState, FormData>(
    parseFreeText,
    EMPTY_PARSE
  );
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <details className="card quick-log">
      <summary>
        <span className="label">Or just say it</span>
        <span className="muted small">3x5 at 60, last one was a grind</span>
      </summary>

      <form action={parseAction} ref={formRef} className="quick-form">
        <input
          name="text"
          type="text"
          placeholder="3x5 at 60, last one was a grind"
          autoComplete="off"
          aria-label="Describe the sets you did"
        />
        <button type="submit" disabled={parsing}>
          {parsing ? 'Reading…' : 'Read it'}
        </button>
      </form>

      {state.error ? <p className="error small">{state.error}</p> : null}

      {state.interpretation !== null && state.exerciseId !== null ? (
        <div className="parsed">
          <p className="small">
            <strong>{state.exerciseName}</strong> — {state.interpretation}
          </p>

          <ul className="parsed-sets small">
            {state.sets.map((set, i) => (
              <li key={i}>
                {set.weight_kg === null ? 'bodyweight' : `${set.weight_kg} kg`} × {set.reps}
                {set.rpe === null ? '' : ` @ RPE ${set.rpe}`}
                {set.is_warmup ? ' · warmup' : ''}
              </li>
            ))}
          </ul>

          {/* Nothing was written to get here. This button is the write. */}
          <form
            action={confirmParsedSets}
            onSubmit={() => formRef.current?.reset()}
            className="row"
          >
            <input type="hidden" name="workoutId" value={workoutId} />
            <input type="hidden" name="exerciseId" value={state.exerciseId} />
            <input type="hidden" name="sets" value={JSON.stringify(state.sets)} />
            <button type="submit">
              Log {state.sets.length} set{state.sets.length === 1 ? '' : 's'}
            </button>
          </form>
        </div>
      ) : null}
    </details>
  );
}
