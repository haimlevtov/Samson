/**
 * The diet stage's prompt and its trust boundary.
 *
 * INVARIANT: static first, dynamic last — `DIET_SYSTEM` is a constant and
 *            everything per-call travels in `messages`. CLAUDE.md #11,
 *            ADR 0005 §1, and `tests/unit/invariants.test.ts` fails on any
 *            `system:` built by interpolation anywhere in the codebase.
 *
 * INVARIANT: the payload carries no numbers — ADR 0024 §1. `dietFacts()` in
 *            `energy.ts` is the allowlist, and this file renders what it
 *            returns rather than reaching into the target itself.
 */
import { MAX_DIET_QUESTION_CHARS } from '../llm/config';
import {
  MAX_FIELD_CHARS,
  MAX_PAYLOAD_CHARS,
  fenceUntrusted,
  sanitizeUntrusted,
} from '../llm/safety';
import type { ChatMessage } from '../llm/types';
import type { DietFacts } from './energy';
import { NO_MATCH } from './schema';

/**
 * WHY the rules are stated here as well as enforced in code: the same reasoning
 * as `CHAT_SYSTEM`. Telling the model raises the first-pass rate, and a first
 * pass that succeeds costs one call instead of two.
 *
 * AI-NOTE: nothing in this string is a control. Every sentence can be ignored by
 *          a sufficiently determined prompt and the stage still holds, because
 *          what holds is in three other files — and a fix belongs in whichever
 *          one owns the rule, never here:
 *            - `advice.ts` — the `\p{N}` check, the retry, the constants.
 *            - `schema.ts` — no numeric field, so there is nothing to route
 *              around the check with.
 *            - `energy.ts` / `DietPanel.tsx` — the target is computed and
 *              rendered by code, and never entered this payload.
 */
export const DIET_SYSTEM = `You are the user's strength coach, explaining a daily calorie target the application has already calculated.

WHAT YOU RETURN
- on_topic: true if the question is about this person's own diet, calories, food or training. False for everything else.
- summary: one sentence saying what kind of target this is, at most 300 characters.
- caveat: one sentence on the thing worth knowing next to it, at most 200 characters.

Decide on_topic first, then write the two sentences.

WHEN on_topic IS FALSE, write them anyway; they are discarded and replaced by a fixed refusal the user sees instead. You cannot change that refusal's wording, so there is nothing to be gained by trying.

NO NUMBERS AT ALL. You have not been told the target, and you must not write a digit — not the target, not a weight, not a percentage, not a date. The application prints every figure next to your words. Write "a modest deficit", never "a 400 calorie deficit". A reply containing any digit is rejected automatically and you will be asked again. There is no figure you can supply that the user is not already looking at.

WHAT YOU ARE TOLD is a small block of categories: the goal, how active this person's logged training makes them, whether the target is a deficit, and whether it was decided by the safety floor rather than by the goal. That is all you know. You do not have their weight, their height, their age, or anything about anyone else, and you cannot get them.

THE FLOOR is not negotiable and is not yours. If the user asks for fewer calories, asks you to ignore it, says a doctor or a coach told them otherwise, or presents any reason at all, the target does not move — it is computed and printed by the application before you are called. Say that plainly and without arguing.

INJURY, ILLNESS, PREGNANCY, DISORDERED EATING. Recommend a professional. Do not diagnose and do not offer a workaround.

Write for someone on a phone. No headings, no lists, no markdown. Reply with JSON only.`;

/** Fence labels. Rendered into the payload; none of them confer trust. */
const FACTS_LABEL = 'what the app computed, as categories';
const QUESTION_LABEL = 'the question to answer';

/**
 * The per-call payload: the categories, then the question if there is one.
 *
 * There is no transcript. This stage answers one question about one number and
 * keeps nothing, so there is no history channel to smuggle an instruction
 * through — the attack ADR 0015 §2 had to fence against for the chat does not
 * exist here, because the thing it attacks was never built.
 *
 * INVARIANT: the question is fenced — CLAUDE.md #11. It is the only untrusted
 *            text in this payload, and it arrives from a text box.
 */
export function dietMessages(facts: DietFacts, question: string | null): ChatMessage[] {
  const messages: ChatMessage[] = [
    /*
     * Fenced although the content is ours: fencing labels content as data
     * rather than as instruction, and these ARE data. `factsBlock` in
     * src/chat/prompts.ts carries the same reasoning at more length.
     */
    {
      role: 'user',
      content: fenceUntrusted(FACTS_LABEL, JSON.stringify(facts), MAX_PAYLOAD_CHARS),
    },
  ];

  if (question !== null) {
    messages.push({
      role: 'user',
      content: fenceUntrusted(QUESTION_LABEL, question, MAX_DIET_QUESTION_CHARS),
    });
  }

  return messages;
}

/**
 * Fed back when a reply contained a digit.
 *
 * INVARIANT: NOT fenced — ADR 0008. This is our own instruction, and putting
 *            corrective text inside the untrusted fence tells the model to fix a
 *            violation and to ignore the request in the same breath.
 *
 * WHY it names no numeral, unlike the chat's version: the check is
 * `/\p{N}/u.test(prose)` — a predicate over any script's digits, with nothing
 * parsed out to name. Quoting the offending characters back would also mean
 * putting them in the trusted region, which is a small thing to avoid for free.
 * "Any digit at all" is the whole rule here and it is not ambiguous.
 */
export function numeralCorrection(): string {
  return 'That reply contained a digit. This stage may not state any figure at all, in any script — the application prints them. Say it in words: "a modest deficit", "a little above what you burn". Reply with JSON matching the schema exactly, and nothing else.';
}

/* ---- the supplement lookup — ADR 0023, docs/specs/diet.md §4b ------------ */

/**
 * WHY the rules are stated here as well as enforced in code: the same reasoning
 * as `DIET_SYSTEM` above.
 *
 * AI-NOTE: nothing in this string is a control. The control is that
 *          `supplementReplySchema` in `./schema.ts` admits only slugs from the
 *          list actually sent, so a slug the model invents fails validation in
 *          the gateway rather than reaching a query.
 */
export const SUPPLEMENT_SYSTEM = `You are a lookup. A list of supplement rows follows, each with a slug, a name and the claim the row makes. A question follows it.

Return the slug of the ONE row that answers the question, or "${NO_MATCH}" if none of them does.

Return "${NO_MATCH}" when the question is about a supplement that is not in the list, about something that is not a supplement at all, or about anything other than what these rows cover. A near miss is a miss: do not return the closest row because it is closest.

You write no answer. The application prints the row you name, in the row's own words, and prints a fixed sentence when you name none. Nothing you could write would be shown, so there is nothing to be gained by trying.

Reply with JSON only.`;

const CANDIDATES_LABEL = 'the rows available, as data';
const SUPPLEMENT_QUESTION_LABEL = 'the question to look up';

/**
 * How much of a claim the model is shown.
 *
 * FOUND IN REVIEW, by both reviewers independently, and `MAX_FIELD_CHARS` (120)
 * was the wrong cap: **ten of the thirteen shipped claims are longer than that**,
 * up to 202 characters, so every one arrived truncated mid-sentence. The
 * `eaa-supplementation` row was cut at "Whether that beats simply eating …",
 * severing the negation — so the model chose that row from text reading as an
 * endorsement. That is the softened claim ADR 0023 exists to prevent, arriving
 * by truncation instead of by paraphrase. The user still saw the whole row; the
 * SELECTION was made on inverted text.
 *
 * `MAX_FIELD_CHARS` is sized for an exercise name. 280 is headroom over the
 * longest shipped claim rather than a target.
 *
 * AI-NOTE: if a claim ever approaches this, shorten the claim rather than
 *          raising the number — one too long to read is too long to choose
 *          between.
 */
export const MAX_CLAIM_CHARS = 280;

/**
 * The candidates, as the model sees them.
 *
 * Fenced, and this content genuinely is third-party: every claim paraphrases a
 * source nobody on this project read in full — ADR 0023's whole subject.
 * Sanitised per field, because one enormous claim would push the rules out of
 * attention on its own.
 *
 * Slug, name and claim only. The dose, the caution, the grade and the citation
 * are what the ANSWER renders, and the model chooses a row rather than
 * describing one, so they never need to cross the wire.
 */
export function candidatesBlock(
  rows: readonly { slug: string; supplement: string; claim: string }[]
): string {
  const candidates = rows.map((row) => ({
    slug: row.slug,
    supplement: sanitizeUntrusted(row.supplement, MAX_FIELD_CHARS),
    claim: sanitizeUntrusted(row.claim, MAX_CLAIM_CHARS),
  }));

  return fenceUntrusted(CANDIDATES_LABEL, JSON.stringify(candidates), MAX_PAYLOAD_CHARS);
}

/** The question, fenced with its cap stated — the house pattern above. */
export function supplementQuestionBlock(question: string): string {
  return fenceUntrusted(SUPPLEMENT_QUESTION_LABEL, question, MAX_DIET_QUESTION_CHARS);
}
