/**
 * What one chat turn returns, and what a transcript is allowed to be.
 *
 * Design and threat model: ADR 0015. The contract, including why each bound is
 * the number it is: docs/specs/coach-chat.md §2.
 *
 * INVARIANT: the Zod schemas are the source of truth and the TS types are
 *            derived from them — CLAUDE.md § Conventions.
 */
import { z } from 'zod';

import { MAX_CHAT_MESSAGE_CHARS } from '../llm/config';
import { MAX_NOTE_CHARS } from './notes';

/**
 * "No row answers this" — the member every non-supplement route carries.
 *
 * Moved here from `src/diet/schema.ts` with the lookup it belongs to (ADR 0015
 * §6). It is a sentinel rather than a null field because the enum is the whole
 * control: a nullable slug would be a second way for the model to say nothing,
 * and this way "none of them" is a value the allowlist admits rather than an
 * absence the code has to interpret.
 *
 * AI-NOTE: a migration adding an evidence row whose slug is literally this
 *          string would shadow it — `src/chat/reply.ts` handles the sentinel
 *          before the lookup for that reason, and `routing.test.ts` pins it.
 */
export const NO_MATCH = '__none__';

/**
 * Which of the three answers the box is giving — ADR 0015 §6.
 *
 * `off_topic` is what `on_topic: false` was. One field deciding one thing beats
 * a boolean and an enum that could disagree with each other.
 */
export const COACH_ROUTES = ['training', 'diet', 'supplement', 'off_topic'] as const;
export type CoachRoute = (typeof COACH_ROUTES)[number];

/**
 * What one turn of the box may return.
 *
 * INVARIANT: built per call from the rows the question will be answered
 *            against, so the supplement allowlist IS the schema — ADR 0023, kept
 *            through the merge into one box rather than restated. A slug the
 *            model invents fails the gateway's own validation and is retried,
 *            instead of reaching a lookup and returning a silent null. A
 *            membership test applied after the call would have been the weaker
 *            shape, and one box is not a reason to accept it.
 *
 * INVARIANT: flat, not a discriminated union — docs/specs/coach-chat.md §2. A
 *            union compiles to `anyOf`, which the structured-output modes across
 *            `STAGE_MODELS` support unevenly, and `provider.require_parameters`
 *            turns an unsupported keyword into a routing error rather than a
 *            graceful degrade. Every field is required; the caller reads only
 *            the ones the route licenses.
 */
export function coachReplySchema(slugs: readonly string[]) {
  const admitted = [NO_MATCH, ...slugs] as [string, ...string[]];

  return z.strictObject({
    /**
     * INVARIANT: declared FIRST, deliberately — ADR 0015 §3 and §6. A model
     *            generating tokens in order commits to the route before it
     *            writes the answer, rather than justifying one it has already
     *            written. Reordering these fields is a behavioural change, not
     *            a cosmetic one.
     *
     * AI-NOTE: this is the model classifying itself, which is a mitigation and
     *          not a control — twice over now, because it decides both whether
     *          to answer and which guard will check the answer. What it buys is
     *          that the WORDING of a refusal is code and that SOME guard always
     *          runs. Do not describe it, in a report or a comment, as confining
     *          the box.
     */
    route: z.enum(COACH_ROUTES),

    /**
     * The answer, at most 700 characters — a few sentences on a phone.
     *
     * WHY it is required on every route, including the two that discard it: a
     * nullable field would give the model a second way to return nothing.
     */
    reply: z.string().min(1).max(700),

    /**
     * The row to render on the `supplement` route, or `NO_MATCH`.
     *
     * WHY it is required on every route rather than optional: same reason as
     * `reply`. `NO_MATCH` is the member every other route carries, and it is
     * also the honest answer when no row covers the question.
     */
    supplement_slug: z.enum(admitted),

    /**
     * One sentence worth keeping about this user, or the empty string — ADR
     * 0030.
     *
     * INVARIANT: declared LAST, and the position carries meaning like `route`'s
     *            does. What is worth remembering is a judgement about an answer,
     *            so the model writes the answer first.
     *
     * WHY the empty string rather than `.nullable()`: the same reasoning
     * `supplement_slug` carries two fields up. A nullable field is a second way
     * to say nothing.
     *
     * WHY the bound here is generous and the real one is in `acceptableNote`:
     * a schema failure costs a whole retry, and this field is optional to the
     * user's actual question. A note that is merely too long should be dropped
     * for free, not paid for — so the schema refuses only an essay, and
     * `MAX_NOTE_CHARS` (the rule) is applied in code afterwards.
     */
    remember: z.string().max(NOTE_SCHEMA_MAX_CHARS),
  });
}

/**
 * The widest `remember` the schema accepts, which is NOT the rule.
 *
 * The rule is `MAX_NOTE_CHARS` and it is applied in code. This exists only so
 * the field cannot be an essay that inflates every completion — a model told
 * "at most 120 characters" that writes 180 should have its note dropped, not
 * cost the user a retry of their whole question.
 */
const NOTE_SCHEMA_MAX_CHARS = MAX_NOTE_CHARS * 4;

export type CoachReply = z.infer<ReturnType<typeof coachReplySchema>>;

/**
 * One turn of the visible transcript.
 *
 * `coach` rather than `assistant` because this is the app's own shape: it is
 * what the UI renders and what the server action round-trips. The mapping onto
 * the gateway's `ChatMessage` roles happens in `prompts.ts`, which is also
 * where the fencing happens — so a turn cannot reach a model without passing
 * the one function that knows which side it came from.
 *
 * INVARIANT: validated on arrival — ADR 0015 §1. This stage has no write path,
 *            so the transcript is not stored: it is held by the client and
 *            comes back with every request. That makes it user input, exactly
 *            as the message is, and it is parsed rather than trusted.
 *
 * AI-NOTE: `role` here is a CLAIM about who said what, not a fact. Nothing
 *          downstream may treat a `coach` turn as trusted — `prompts.ts` fences
 *          both kinds and gives neither an assistant role. If server-side
 *          storage is ever added, this schema stays: the client would still be
 *          the one saying which conversation it is.
 */
export const chatTurnSchema = z.strictObject({
  role: z.enum(['user', 'coach']),
  /**
   * Capped at the same length one message may be. `sanitizeUntrusted` applies
   * the same bound again when the turn is fenced; this is the parse-time
   * rejection, so an over-long turn never reaches the prompt layer at all.
   */
  text: z.string().min(1).max(MAX_CHAT_MESSAGE_CHARS),
});

export type ChatTurn = z.infer<typeof chatTurnSchema>;

/**
 * How much scrollback survives a round trip.
 *
 * WHY bounded well above `MAX_HISTORY_TURNS` (8): the model sees the last few
 * turns, but the user reads further back than the coach remembers, and losing
 * the visible conversation mid-chat is worse than a coach with a short memory.
 * It is still bounded, because every turn here is re-sent on every message.
 */
export const MAX_TRANSCRIPT_TURNS = 40;

export const chatHistorySchema = z.array(chatTurnSchema).max(MAX_TRANSCRIPT_TURNS);
