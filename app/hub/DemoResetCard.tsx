import { DEMO_ACCOUNT_EMAIL, RESET_KEEPS, RESET_TABLES } from '@/src/db/demo-reset';
import { resetDemoAccount } from './reset-actions';

/**
 * The demo reset — ADR 0032 §4, and it is on two pages now.
 *
 * WHY it moved out of `app/hub/page.tsx`: it was on Hub only, and **the account
 * it exists for cannot reach Hub.** `HubPage` sends a user whose `onboarded_at`
 * is null to `/welcome`, and the demo account's `onboarded_at` is null by
 * design — that IS the fixture. So the control that exists to restart the demo
 * could only be reached by somebody who had already finished the demo. The owner
 * asked where the reset button was; this is where it was.
 *
 * Nothing about the GATE was wrong. The placement was, and the fix is that the
 * card renders wherever the demo account actually is.
 *
 * INVARIANT: this is a hint, not a control. Rendering is keyed on the email; the
 *            authority is `reset_demo_account()`, which is `security definer`,
 *            takes no argument, and checks `raw_app_meta_data` — a column no
 *            signed-in user can write. A server action is an endpoint, so a card
 *            that is not drawn stops nobody from POSTing to it.
 */
export function DemoResetCard({
  email,
  from,
  reset,
}: {
  email: string | null;
  /** Where the action sends its refusals back to — see reset-actions.ts. */
  from: '/hub' | '/welcome';
  /** The `?reset=` this page was loaded with, if any. */
  reset: string | undefined;
}) {
  if (email !== DEMO_ACCOUNT_EMAIL) return null;

  return (
    <>
      <h2 className="section">Demo</h2>
      <div className="card danger-card">
        <p>
          This is the empty demo account. Resetting returns it to the state a brand-new user sees —
          the welcome questions, no history, no plan.
        </p>
        <p className="muted small">
          It deletes your {RESET_TABLES.join(', ')}. It keeps {RESET_KEEPS.join(' and ')}.
        </p>
        {reset === 'unconfirmed' ? (
          <p className="error" role="status">
            Type RESET to confirm.
          </p>
        ) : null}
        {reset === 'failed' ? (
          <p className="error" role="status">
            That did not go through. Nothing may have been removed — try again.
          </p>
        ) : null}
        <form action={resetDemoAccount} className="row reset-form">
          {/*
           * Which page to come back to when the confirmation is wrong or the
           * reset fails. An allowlist on the server, not a trusted path: this is
           * a form field, and an open redirect built out of one is a classic.
           */}
          <input type="hidden" name="from" value={from} />
          <label className="grow">
            <span className="label">Type RESET to confirm</span>
            <input type="text" name="confirm" autoComplete="off" placeholder="RESET" />
          </label>
          <button type="submit" className="secondary">
            Reset this demo account
          </button>
        </form>
      </div>
    </>
  );
}
