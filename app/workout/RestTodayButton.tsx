'use client';

import { useFormStatus } from 'react-dom';

/**
 * Rest today's submit button — ADR 0034.
 *
 * WHY it ignores a press while the first is pending — FOUND IN REVIEW. Next runs
 * server actions one after another, so a second tap reached `logRestDay` after
 * the first had logged the day, landed on the receipt with no `?unlocked=`, and
 * replaced the first press's navigation — on the tenth rest day, the
 * `ten-rest-days` reveal. The second press was otherwise harmless.
 *
 * WHY `aria-disabled` and a cancelled click rather than `disabled`: disabling
 * the focused control drops keyboard focus — the reason the Try and Deliver
 * buttons stay live. The label says what is happening instead.
 */
export function RestTodayButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="secondary"
      aria-disabled={pending}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      {pending ? 'Logging your rest day…' : 'Rest today'}
    </button>
  );
}
