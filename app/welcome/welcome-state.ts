/**
 * What a welcome step returns when it refuses — ADR 0032 §2.
 *
 * Its own module because a `'use server'` file may export only async functions,
 * so a type declared beside the actions is unreachable from the component.
 *
 * INVARIANT: a rejected step KEEPS WHAT WAS TYPED — docs/specs/mobile-interface.md
 *            §4, "the form keeps its values". The first version of these steps
 *            redirected on any failure, so one out-of-range height cost the user
 *            their weight, height, date of birth and sex. FOUND IN REVIEW.
 */
export interface WelcomeState {
  /** A code-owned sentence, or null. Never an upstream message — ADR 0028. */
  error: string | null;
  /**
   * What the user submitted, echoed back so the inputs can be refilled.
   *
   * Strings rather than parsed values: what goes back in the box is what came
   * out of it, and a parsed number would silently rewrite "82.50" as "82.5"
   * under somebody's cursor.
   */
  values: Record<string, string>;
}

export const EMPTY_WELCOME: WelcomeState = { error: null, values: {} };

/**
 * The two sentences a step can say, and which one is which — ADR 0028.
 *
 * They are separate because they ask for different things: the first is "what
 * you typed is not what I can use", which the user can act on; the second is
 * "the write failed", which they cannot, and telling somebody with perfectly
 * valid input to have another go is how a form becomes a loop. The first
 * version of these actions collapsed both into the first sentence.
 */
export const INVALID_MESSAGE = 'That did not look right. Have another go.';
export const SAVE_FAILED_MESSAGE = 'Could not save that. Try again in a moment.';
