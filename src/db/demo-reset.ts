/**
 * Returning the demo account to nothing — ADR 0032 §4.
 *
 * INVARIANT: every delete below runs on the request-scoped, RLS-bound client and
 *            is filtered to the caller — CLAUDE.md #10. No service role. The
 *            `user_id` filters are redundant under RLS and are written anyway:
 *            they make each statement say what it means, and they are what fails
 *            loudly if a policy is ever loosened.
 *
 * INVARIANT: the blast radius is the CALLER, always. The email gate in the
 *            action above this is a convenience — it decides who is OFFERED the
 *            button — and if it were bypassed entirely, the result would be that
 *            somebody deleted their own training. That property is RLS's, not
 *            the gate's, and it is the one worth relying on.
 */
import type { Db } from './client';

/**
 * The one account this is offered to.
 *
 * A constant rather than a column: it exists for a demo, it is checked
 * server-side against the session's own email, and a column would invite the
 * question of who may set it.
 */
export const DEMO_ACCOUNT_EMAIL = 'fresh@samson.test';

/**
 * What the confirmation names, in the order it is deleted.
 *
 * Children before parents: `sets` references `workouts`, and
 * `achievement_events` and `xp_events` reference the user. Deleting a parent
 * first would either fail on a foreign key or cascade something this list does
 * not mention — and a control that removes more than it says is the one thing
 * this must not be.
 *
 * AI-NOTE: this list is what the user is shown. A table added to the delete
 *          without a line here is a table deleted without being named.
 */
export const RESET_TABLES = [
  'sets',
  'workouts',
  'workout_templates',
  'plan_runs',
  'challenges',
  'achievement_events',
  'xp_events',
  'coach_notes',
  'user_equipment',
] as const;

/**
 * The profile is CLEARED rather than deleted, and that is a decision.
 *
 * `public.users` has `select`, `insert` and `update` policies for the owner and
 * **no delete policy at all** — so a delete would match no rows and succeed
 * silently, leaving the display name and the biometrics behind while the button
 * reported success. FOUND while writing this, by reading the policies rather
 * than assuming a `for all`.
 *
 * The fix could have been a `users_delete_own` policy. It is not, because
 * widening RLS so a demo button can work is the wrong trade: every reader of
 * this table already defaults for a missing field (`currentUser` reads with
 * `maybeSingle`), so a row of nulls and no row at all are the same thing to the
 * app — and one of them does not require a new capability for every user in the
 * project.
 *
 * AI-NOTE: the column list is what makes this equivalent to deletion. A column
 *          added to `users` that carries user-entered content belongs here too,
 *          or the reset quietly stops being one.
 */
const PROFILE_FIELDS = {
  display_name: null,
  bodyweight_kg: null,
  height_cm: null,
  birth_date: null,
  sex: null,
  diet_goal: null,
} as const;

/**
 * What is deliberately NOT deleted, and why — ADR 0032's Consequences.
 *
 * `llm_calls` stays. The weekly budget is computed from it (ADR 0026), so
 * clearing those rows would turn this button into a way to refill the project's
 * spend limit on demand. The demo account resets its training; it does not reset
 * its bill.
 *
 * The user's SETTINGS stay too — timezone, theme, humour ceiling, leaderboard
 * opt-out. They are preferences about using the app rather than training data,
 * and a reset that silently moved somebody's timezone would be doing something
 * nobody asked for.
 *
 * The auth user stays too: what goes is everything the app wrote, so the next
 * sign-in lands on `/welcome` again, which is the entire point.
 */
export const RESET_KEEPS = ['llm_calls', 'the account itself'] as const;

/**
 * Deletes everything the app has written for this user.
 *
 * Sequential rather than `Promise.all`, and the order is the one above: these
 * are separate statements with no transaction across them (PostgREST gives
 * none), so a failure partway leaves a partially reset account. That is
 * acceptable here in a way it would not be elsewhere — the remedy is to press
 * the button again, and the account is a demo fixture by construction.
 */
export async function resetDemoData(db: Db, userId: string): Promise<void> {
  for (const table of RESET_TABLES) {
    // Every table here is keyed by `user_id`, which CLAUDE.md #10 requires of
    // all of them — checked against the generated types rather than assumed.
    const { error } = await db.from(table).delete().eq('user_id', userId);
    if (error) throw new Error(`resetting ${table}: ${error.message}`);
  }

  // Last, and only if the rows above went: a profile cleared while the training
  // survived would be a worse state than either end of this operation.
  const { error } = await db.from('users').update(PROFILE_FIELDS).eq('user_id', userId);
  if (error) throw new Error(`resetting users: ${error.message}`);
}
