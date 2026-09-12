/**
 * What a failed action may tell the user, and what it may log — ADR 0028.
 *
 * Pure: no key, no network, no database, no `console`. The same treatment
 * `src/speech/refusal.ts` got for the same reason — the judgement is the part
 * worth testing, and a `catch` block in a `'use server'` module is the part that
 * cannot be.
 *
 * INVARIANT: exactly two error classes reach the user verbatim, and adding a
 *            third means arguing it past ADR 0028's test — can the user act on
 *            it, or are they entitled to it — in that document. A `catch` branch
 *            somewhere is not the place.
 */
import { MissingApiKeyError } from './config';
import { BudgetExceededError } from './types';

/**
 * How much of a message reaches the log.
 *
 * Long enough to identify a Postgres constraint or an HTTP status, short enough
 * that a provider echoing a whole rejected request does not land in full. The
 * NAME beside it is what actually carries the diagnosis.
 */
export const LOG_MESSAGE_MAX_CHARS = 200;

/**
 * Whether this failure's own words are the user's business — ADR 0028 §1.
 *
 * `MissingApiKeyError` says exactly what to do and names no internals.
 * `BudgetExceededError` reports the user their OWN spend against their own
 * ceiling, which they are entitled to and which explains a refusal that would
 * otherwise look like a bug.
 */
export function isUserFacing(cause: unknown): boolean {
  return cause instanceof MissingApiKeyError || cause instanceof BudgetExceededError;
}

/**
 * What the user reads: the failure's own words when they are for the user, and
 * the caller's sentence otherwise — ADR 0028 §1 and §2.
 *
 * WHY a caller-supplied fallback rather than one constant here: the sentence has
 * to say what THIS surface lets the user do next, and "try again" is wrong on a
 * surface where the thing to do is add a missing detail in Settings. The
 * judgement about which errors are sayable is shared; the wording is local.
 *
 * INVARIANT: never a prefix of a non-user-facing message, never "the error was
 *            …". A length bound is not a content bound — `LlmCallFailedError`'s
 *            message is capped and what it is capped to is still the provider's
 *            words, including up to 500 characters of a body providers commonly
 *            fill with the request they rejected.
 */
export function userFacingError(cause: unknown, fallback: string): string {
  return cause instanceof Error && isUserFacing(cause) ? cause.message : fallback;
}

/**
 * The second argument to `console.error`: the NAME and a bounded message, never
 * the object — ADR 0028.
 *
 * WHY never the object: `LlmCallFailedError` declares `attempts: LlmCallInsert[]`
 * as an enumerable own property, and Node prints those after the stack. Every one
 * of those rows carries `user_id`, so logging the object wrote the user's auth
 * UUID into the server log up to three times per failure, plus the upstream body.
 *
 * WHY the name: `LlmCallFailedError` versus `SafetyBlockedError` versus a
 * Postgres error is the whole diagnosis, and it is exactly what the user-facing
 * sentence had to discard.
 */
export function logLine(cause: unknown): string {
  if (!(cause instanceof Error)) return 'unknown';
  return `${cause.name}: ${cause.message.slice(0, LOG_MESSAGE_MAX_CHARS)}`;
}
