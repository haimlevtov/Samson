/**
 * Returning the demo account to nothing — ADR 0032 §4.
 *
 * INVARIANT: the work happens in `reset_demo_account()`, a `security definer`
 *            function that takes NO ARGUMENT. The user is `auth.uid()` from the
 *            verified JWT, so a caller cannot express the wish to delete
 *            somebody else's rows — there is nowhere to put the id.
 *
 * FOUND IN REVIEW, and this module got it wrong first. It looped over nine
 * tables deleting `.eq('user_id', userId)` on the RLS-bound client, having read
 * the policies for `public.users` and assumed them for the rest. Four of the
 * nine — `plan_runs`, `challenges`, `achievement_events`, `xp_events` — are
 * select-only by deliberate decision (ADR 0009: no completion is granted from
 * the client). A delete against those matched no rows and SUCCEEDED, so the app
 * reported a reset while the XP, the badges, the challenges and the accepted
 * plan all survived — and the card had named them.
 *
 * The fix is not `..._delete_own` policies: `achievement_events` is once-only,
 * so a user who could delete their own rows could re-earn every badge and be
 * paid its XP again. The migration argues that at length.
 */
import type { Db } from './client';

/**
 * The one account this is offered to.
 *
 * A constant rather than a column: it exists for a demo, and a column would
 * invite the question of who may set it.
 *
 * AI-NOTE: FOUR copies of one fact, and only two are held together by a test.
 *          This constant, `reset_demo_account()` in the migration (held by
 *          `tests/db/demo-reset.test.ts`, which calls it as a user who is not
 *          the demo account and expects a refusal), `FRESH_ACCOUNT.email` in
 *          `src/seed/archetypes.ts`, and the sign-in page's fixture list. A
 *          change has to reach all four.
 */
export const DEMO_ACCOUNT_EMAIL = 'fresh@samson.test';

/**
 * What the confirmation names, in the order the function deletes it.
 *
 * AI-NOTE: this list is what the user is SHOWN, and the function is what runs.
 *          A table in one and not the other is either a deletion nobody was told
 *          about or a promise nothing keeps — the second of which is what review
 *          found here. `workout_template_items` is named because it goes by
 *          cascade from `workout_templates`, which is still a deletion.
 */
export const RESET_TABLES = [
  'your name and body measurements',
  'sets',
  'workouts',
  'workout_templates',
  'workout_template_items',
  'plan_runs',
  'challenges',
  'achievement_events',
  'xp_events',
  'coach_notes',
  'user_equipment',
] as const;

/**
 * What is deliberately kept, and why — ADR 0032's Consequences.
 *
 * `llm_calls` stays: the weekly budget is computed from it (ADR 0026), so
 * clearing those rows would turn this button into a way to refill the project's
 * spend limit on demand. The demo account resets its training; not its bill.
 *
 * SOME settings stay — timezone, theme, humour ceiling, leaderboard opt-out.
 * They are preferences about using the app rather than training data, and a
 * reset that silently moved somebody's timezone would be doing something nobody
 * asked for.
 *
 * The PROFILE fields do not: name, bodyweight, height, date of birth and sex are
 * cleared, because they are the answers onboarding asks for and the flow has to
 * ask again. FOUND IN REVIEW — this list said "your settings" while the function
 * nulled five of the eight fields on the settings form, which is the promise-
 * nothing-keeps half of this module's own AI-NOTE.
 *
 * The account stays: what goes is everything the app wrote, so the next sign-in
 * lands on `/welcome` again, which is the entire point.
 */
export const RESET_KEEPS = [
  'your sign-in',
  'your timezone, theme and humour setting',
  "the app's own usage log",
] as const;

/**
 * Runs the reset for the signed-in caller.
 *
 * One round trip, one transaction. The loop this replaced had neither: a failure
 * partway through left an account half reset, under a card saying to try again.
 */
export async function resetDemoData(db: Db): Promise<void> {
  const { error } = await db.rpc('reset_demo_account');
  if (!error) return;

  /*
   * `code` and `hint` only — the discipline every other write in this feature
   * follows, and this one did not: it interpolated `error.message`, so
   * `logLine` printed the bare name `Error` carrying raw Postgres text. ADR
   * 0028 says the NAME is the diagnosis, and the caller's own comment claimed
   * row contents never reach the log. FOUND IN REVIEW.
   */
  console.error('demo reset rpc failed', { code: error.code, hint: error.hint });
  throw new DemoResetError();
}

/** Named, so the log line says which failure this was — ADR 0028. */
export class DemoResetError extends Error {
  constructor() {
    super('the demo reset did not complete');
    this.name = 'DemoResetError';
  }
}
