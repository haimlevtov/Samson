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
 * AI-NOTE: THREE copies of one fact, and two of them are held together by a
 *          test. This constant, the gate inside `reset_demo_account()` (held by
 *          `tests/db/demo-reset.test.ts`, which calls it as a user who is not
 *          the demo account and expects a refusal), and `FRESH_ACCOUNT.email`
 *          in `src/seed/archetypes.ts`. A change has to reach all three.
 *
 *          It was four: the sign-in page had the address typed into its fixture
 *          list, and it imports this now.
 */
export const DEMO_ACCOUNT_EMAIL = 'fresh@samson.test';

/**
 * The published fixture password — `scripts/seed.ts` creates every demo account
 * with it and the sign-in page prints it.
 *
 * Here so that `app/` has ONE copy: the sign-in page had it typed twice and the
 * reset action would have been a third. It is not a secret in any sense — the
 * page it serves displays it in a `<code>` block on purpose, so the demo runs.
 *
 * AI-NOTE: `scripts/seed.ts`, `scripts/eval-planner.ts`, `tests/db/helpers.ts`
 *          and `tests/db/candidates.test.ts` each still hold their own copy.
 *          They cannot import this module — it reaches for the app's `Db` type —
 *          so changing the password means changing five files, not one.
 */
export const DEMO_FIXTURE_PASSWORD = 'samson-demo-fixture';

/*
 * `RESET_TABLES` and `RESET_KEEPS` WERE HERE, and they are deleted rather than
 * left for a future reader to wire back up.
 *
 * They existed to hold one pair of facts together: what the confirmation card
 * told the user it would delete, and what the function actually deleted. Review
 * found those two disagreeing twice, so the arrays were worth their weight
 * while a card rendered them.
 *
 * The card is gone — ADR 0032's second amendment: the reset is one button on the
 * sign-in page, with no explanation and no confirmation, which is what the owner
 * asked for. Two arrays nothing renders, under an AI-NOTE describing a screen
 * that no longer exists, are a worse guard than none: they read as maintained.
 *
 * What the function deletes is now stated in one place — the migration — and
 * asserted in one place: `tests/db/demo-reset.test.ts`, which counts rows in
 * every table afterwards.
 */

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
