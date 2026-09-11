/**
 * The only place in the codebase that reads the OpenRouter key.
 * INVARIANT: all LLM calls go through src/llm/gateway.ts — CLAUDE.md #2
 */

/** Anything env-shaped. Avoids forcing callers to fake all of NodeJS.ProcessEnv. */
export type Env = Record<string, string | undefined>;

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Per-stage output ceilings.
 *
 * INVARIANT: max_tokens is always set — CLAUDE.md #2. These are the values the
 *            pipeline stages pass; there is no unbounded call path.
 *
 * WHY the planner ceiling is 6k and not 16k: it WAS 16k, and a four-week block
 * hit that exact number without finishing, in 158 seconds, returning truncated
 * JSON — ADR 0007. Set groups cut expected output to roughly 1,500–2,500
 * tokens, and 6k is generous headroom for a twelve-week block. A ceiling this
 * far above the expected size is a safety net, not a target: if a block ever
 * approaches it again, the shape is wrong, not the number.
 */
export const PLANNER_MAX_TOKENS = 6_000;
export const CRITIC_MAX_TOKENS = 1_500;

/**
 * The persona returns prose only — an opening, a note per week, a closing —
 * so it is small next to a block. Generous enough for a twelve-week plan.
 */
export const PERSONA_MAX_TOKENS = 2_000;

/** Free text into one exercise and its sets. Small by construction. */
export const NORMALIZER_MAX_TOKENS = 800;

/**
 * One conversational reply — docs/specs/coach-chat.md §2.
 *
 * WHY it is the smallest ceiling in the file: the schema caps `reply` at 700
 * characters, which is roughly 200 tokens, so 400 is headroom rather than a
 * target. This is also the only stage a user can invoke repeatedly by typing,
 * which makes its ceiling the one that decides what abuse costs.
 */
export const CHAT_MAX_TOKENS = 400;

/**
 * One diet explanation — docs/specs/diet.md §4, ADR 0024 §1.
 *
 * WHY it is smaller than the chat's 400: the schema caps this reply at 500
 * characters across two fields, and unlike the chat it may contain no numeral
 * at all — code renders every figure beside it. The model is writing two or
 * three sentences of plain prose about a number it was never shown.
 */
export const DIET_MAX_TOKENS = 300;

/**
 * One supplement lookup — `src/diet/supplements.ts`.
 *
 * The smallest ceiling in the file, and it can be: the whole answer is one slug
 * from an allowlist. There is no text field in that schema, so there is nothing
 * for the model to be verbose in. Sixty leaves room for the JSON wrapper and a
 * long slug, and nothing else.
 */
export const SUPPLEMENT_MAX_TOKENS = 60;

/**
 * One optional question about a target, before fencing.
 *
 * Deliberately shorter than `MAX_CHAT_MESSAGE_CHARS`: this box asks about one
 * figure on one screen, not about a training history. Length is an attack, so
 * the bound is the smallest one the feature can work in — the same reasoning
 * ADR 0015 §5 gives for the chat's own cap.
 */
export const MAX_DIET_QUESTION_CHARS = 400;

/**
 * One chat message in, before fencing — ADR 0015 §5.
 *
 * Deliberately far below `MAX_UNTRUSTED_CHARS`: that cap is sized for a whole
 * workout note, and a question about training is a sentence or two. Length is
 * an attack, so the bound is the smallest one the feature can actually work in.
 */
export const MAX_CHAT_MESSAGE_CHARS = 800;

/**
 * Prior turns replayed with each message, newest kept.
 *
 * WHY bounded at all: the transcript is user-authored text being fed back to
 * the model on every turn — ADR 0015 §2. Unbounded, it is both a cost leak and
 * an attention-dilution attack, and it is the half of the input that grows
 * without anybody pressing anything.
 */
export const MAX_HISTORY_TURNS = 8;

/**
 * Planner→rules→critic passes before a run is abandoned.
 * WHY a hard cap rather than "until it passes": an unbounded revision loop is
 * the failure mode the budget gate exists to catch, and catching it there means
 * it has already been paid for.
 */
export const MAX_PLAN_ITERATIONS = 3;

/** Backoff for transport failures. Deliberately short — a demo cannot wait. */
export const RETRY_BASE_DELAY_MS = 500;

/**
 * The planner gets longer than the 60s default.
 *
 * WHY: measured generation runs near 100 output tokens per second, so a 2,500
 * token block is ~25s plus prompt processing — comfortably inside 60s, but with
 * little margin on a slow provider. Two minutes is slack, not permission to be
 * slow: the schema change in ADR 0007 is what made the call finish at all.
 */
export const PLANNER_TIMEOUT_MS = 120_000;

/**
 * Charged against the budget for a call that timed out.
 *
 * WHY this exists — ADR 0007: a timed-out call costs real money and writes
 * cost_credits null, because the gateway never reads a response and so has
 * nothing to record. Fourteen timeouts once reported $0.00005 to the ledger
 * while OpenRouter billed $0.5269. sumSpendSince reads cost_credits, so the
 * budget gate was blind to exactly the runaway it exists to stop.
 *
 * The ledger keeps recording only MEASURED cost — the token analysis is a
 * graded output and estimates in it would be corruption. This charge is applied
 * by the budget gate alone, and it is deliberately pessimistic.
 *
 * AI-NOTE: this is a guess in the safe direction. If a real figure ever becomes
 *          available for timed-out calls, delete the assumption rather than
 *          tuning it.
 */
export const TIMEOUT_ASSUMED_COST_USD = 0.05;

/**
 * The longest input the speech stage sends — ADR 0025.
 *
 * WHY a ceiling on characters: a speech model has no `max_tokens`, and what it
 * is billed on is what it says. The input is src/speech/script.ts's preamble
 * (184) and labels (40), a direction of at most 600 characters and a line of at
 * most 280 (both column limits): 1,104 at the most, which src/speech/script.test.ts
 * holds under this.
 *
 * INVARIANT: `callSpeech` refuses any input longer than this, so there is no
 *            unbounded speech call — CLAUDE.md #2.
 */
export const SPEECH_MAX_INPUT_CHARS = 1_200;

/**
 * A preview is a button press, and a few seconds of audio takes a few seconds
 * to make. Two attempts of twenty seconds bounds the wait at under a minute.
 */
export const SPEECH_TIMEOUT_MS = 20_000;
export const SPEECH_MAX_ATTEMPTS = 2;

/**
 * The shortest and longest clip the speech stage accepts — ADR 0025,
 * "Corrected after the first live calls".
 *
 * WHY a floor, in seconds: the WAV header makes any bytes playable, so a 200
 * carrying a few bytes of junk would be charged, cached and played as a click
 * with no message. A quarter second is shorter than any line a coach says.
 * WHY a ceiling, in bytes: a Vercel function may return about 4.5 MB, and what
 * cannot cross it is bytes, whatever rate a response names — a seconds-based
 * ceiling at 48 kHz would have allowed twice this. 4,320,000 is ninety seconds
 * of the model's 24 kHz PCM, three times the longest line spoken slowly.
 */
export const SPEECH_MIN_AUDIO_SECONDS = 0.25;
export const SPEECH_MAX_AUDIO_BYTES = 4_320_000;

/**
 * Charged against the budget for each speech attempt that reached a 200 and did
 * not time out — a clip, or a 200 with no usable one — ADR 0025, Cost and
 * addendum. A timed-out attempt is charged TIMEOUT_ASSUMED_COST_USD instead.
 *
 * WHY this exists: the provider returns audio and no price, so a speech row
 * records cost_credits null and the gate would otherwise count every preview
 * as free. The same split TIMEOUT_ASSUMED_COST_USD makes — the ledger records
 * only what was measured, and the estimate is applied by the budget gate alone
 * (src/db/ledger.ts).
 *
 * Sized for the longest line the stage accepts: 280 characters spoken slowly
 * is about thirty seconds, 750 audio tokens at 25 a second, $0.015 at $20 per
 * million, plus the direction as input at $1 per million. About $0.016,
 * rounded up. A typical line costs half of it, so this is pessimistic, which
 * is the safe direction for a budget.
 *
 * AI-NOTE: sized for a sample line and nothing longer. The PR that reads a
 *          delivered plan aloud — a minute or more — must replace this flat
 *          figure with one that scales with what is spoken, before it ships.
 *          And as with TIMEOUT_ASSUMED_COST_USD: if a real figure becomes
 *          available, delete the assumption rather than tuning it.
 */
export const SPEECH_ASSUMED_COST_USD = 0.02;

export class MissingApiKeyError extends Error {
  constructor() {
    // WHY: named error rather than a hang or a cryptic 401, because the phase 0
    //      acceptance criterion is that the suite passes with no key present —
    //      a test asserts this exact failure mode.
    super('OPENROUTER_API_KEY is not set. Copy .env.example to .env.local and fill it in.');
    this.name = 'MissingApiKeyError';
  }
}

export function readApiKey(env: Env = process.env): string {
  const key = env['OPENROUTER_API_KEY'];
  if (!key || key.trim() === '') throw new MissingApiKeyError();
  return key;
}

/**
 * Whether a key is set, without handing it to the caller.
 *
 * For a page deciding whether to offer something only a model can do — the
 * Coach tab's voice, which shows a line as text rather than a button that
 * cannot speak (docs/specs/mobile-interface.md §4).
 */
export function hasApiKey(env: Env = process.env): boolean {
  const key = env['OPENROUTER_API_KEY'];
  return key !== undefined && key.trim() !== '';
}

/** Optional attribution headers. Cosmetic; calls succeed without them. */
export function attributionHeaders(env: Env = process.env): Record<string, string> {
  const headers: Record<string, string> = {};
  const url = env['OPENROUTER_APP_URL'];
  const name = env['OPENROUTER_APP_NAME'];
  if (url) headers['HTTP-Referer'] = url;
  if (name) headers['X-Title'] = name;
  return headers;
}

export function modelOverrideFromEnv(env: Env = process.env): string[] | undefined {
  const raw = env['LLM_MODELS'];
  if (!raw) return undefined;
  const models = raw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return models.length > 0 ? models : undefined;
}
