'use client';

import { finishWorkout } from '../actions';
import { clearDraft } from './session-draft';

/**
 * Ending the session, from two places.
 *
 * The form carries an id so the button in the session bar can submit it with
 * `form="finish-session"` — one form, one action, whichever button is nearer
 * the thumb. Duplicating it would be two definitions of what finishing means.
 *
 * WHY it confirms: finishing settles XP, streaks and achievements, and there is
 * no way back to an in-progress session from the UI. A mis-tap at the top of
 * the screen would end a workout mid-set.
 */
export function FinishForm({ workoutId }: { workoutId: string }) {
  return (
    <form
      id="finish-session"
      action={finishWorkout}
      className="finish-form"
      onSubmit={(event) => {
        if (!window.confirm('Finish this session?')) {
          event.preventDefault();
          return;
        }
        // Pending rows die with the session they belonged to. Leaving them
        // would resurrect half-typed sets on a workout that is already closed.
        clearDraft(workoutId);
      }}
    >
      <input type="hidden" name="workoutId" value={workoutId} />
      <label>
        <span className="label">Notes (optional)</span>
        <input name="notes" placeholder="Felt heavy, right knee a bit tight" />
      </label>
      <button type="submit">Finish session</button>
    </form>
  );
}
