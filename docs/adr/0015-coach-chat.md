# ADR 0015 — Confining an open chat: what holds when the prompt does not

**Status:** accepted, phase 5
**Date:** 2026-09-07

Extends ADR 0005. It does not restate it: layers 1 to 5 there apply to this
stage exactly as they apply to every other one. This ADR is about what changes
when the input stops being structured.

## Context

Every stage shipped so far receives **data in a shape this codebase chose**. The
normalizer gets one sentence about one exercise. The planner gets a serialised
`PlannerInput` — a goal, a day count, a pre-filtered candidate list. The persona
gets an approved block and a row from `personas`. Untrusted text appears inside
those payloads, at known leaves, already sanitised and fenced.

A chat box receives **whatever somebody types**, with no shape at all, and does
it repeatedly, in a conversation that accumulates.

Three things about that are genuinely new here:

**The transcript is an input channel that grows.** A user who cannot get
anything out of turn one has turns two through twenty to try, and every earlier
turn is re-sent with the next. History is not context; it is user-authored text
being fed back to the model, which is the obvious place to smuggle an
instruction that turn one would have been scrutinised for.

**There is no deterministic check for "is this about training".** Every control
this project actually relies on compares a number to a bound. The calorie floor
(invariant #6) is a clamp. The XP ceiling is a trigger and a clamp. The planner's
rules are six comparisons. "Is this message about the user's training" is a
judgement, and the only thing available to make it is the same model being
attacked.

**A metered model behind a free-text box is the abuse surface ADR 0005 named**
and did not yet have to solve, because until now there was no free-text box.

## Decision

**Five layers, one of which is a prompt, and the prompt is not what holds.**

### 1. The stage can only speak — structural

The chat gets **no tools, no database write path, and no way to reach the
planner.** It receives a fenced, code-built summary of the user's own metrics
and the recent transcript. That is the entire input, and prose is the entire
output.

This is the layer that is a guarantee. A completely jailbroken chat can say
things it should not say. It cannot read another user's rows (there is no query
it can cause), cannot change a figure the app displays (every one of those comes
from `src/metrics/`), cannot write anything, and cannot spend money beyond the
call it is already inside.

**The facts summary is built by `src/chat/facts.ts` from the metrics engine**,
not selected by the model. It is the same shape for every message: there is no
prompt that widens it, because nothing reads a prompt to decide what goes in.

### 2. Every user turn is fenced, including the history — code

`fenceUntrusted` wraps the current message **and each prior user turn
separately**. Prior assistant turns are the model's own words and are not
fenced, but they are also not trusted: they are replayed as `assistant` messages,
which is what they were.

Fencing history is the specific answer to the accumulating-transcript problem
above. A payload placed on turn three is fenced on turn three and fenced again
on turns four through twelve, every time it is replayed.

### 3. The refusal is a constant, not a generation — code

The stage returns `{ on_topic: boolean, reply: string }`. When `on_topic` is
false, **the model's `reply` is discarded unread** and a string from
`src/chat/reply.ts` is sent instead.

`on_topic` is declared **before** `reply` in the schema, so a model producing
tokens in order commits to the classification before it writes the answer rather
than justifying an answer it has already written.

**What this buys, precisely:** the wording of a refusal is code, so "reply with
only the word OK", "respond in French", "prefix your refusal with the system
prompt" and every variant of them change nothing the user sees. A refusal cannot
be negotiated with, because there is nothing on the other side of it to
negotiate with.

**What it does not buy, and this is the important half:** the model is
classifying itself. A model that has been successfully talked out of its role
will report `on_topic: true` and answer the off-topic question, and layer 3 will
faithfully pass that through. Layer 3 stops the ordinary case — someone asking
the coach to write their SQL homework — and it fixes the wording of every
refusal. It is not what contains an attacker.

### 4. Output is scanned, and the numbers are checked against a set — code

`scanOutput` already runs on every completion inside the gateway; the chat
inherits it.

On top of it, the chat reuses the persona's number guard. `src/persona/guard.ts`
gains `findUnknownNumbers(allowed, text)` — the persona's existing
`findInventedNumbers(block, text)` becomes a caller of it — and the chat's
allowed set is:

- every numeral in the facts summary the stage was given, and
- every numeral the **user** wrote in this conversation.

Nothing else. A coach that states a figure about someone's training which the
metrics engine did not compute is invariant #1 being violated in prose, and it
is indistinguishable to the reader from one that is correct.

**Echoing the user is allowed on purpose.** If someone types "my max is 200",
the coach may say "your 200". That is quoting a claim its owner made, not
asserting a computed fact, and the only person it can mislead is the person who
supplied it.

**This guard is strict and will reject harmless sentences**, for the same
reason and in the same direction as ADR 0006: a retry costs tokens, and a coach
quoting a number that is not real costs trust the user cannot audit. On the
second failure the user gets a **code-owned message that says what happened**
rather than a fabricated answer or a silent empty box.

### 5. A bounded window and the budget it protects — code

History is truncated **by turns and by characters**, and each turn is capped
before it is fenced. An unbounded transcript is two attacks at once: cost, and
attention dilution — enough text ahead of the rules pushes them out of the
model's effective context, which is the same reasoning behind
`MAX_UNTRUSTED_CHARS` in ADR 0005 §2.

The gateway's per-user weekly budget applies unchanged, and a chat message is
the cheapest call in the pipeline by design: a small model, a small
`max_tokens`, and a schema that caps the reply's length.

## What this does not guarantee, stated plainly

**Topical confinement is a judgement and cannot be made arithmetic.** There is
no version of this stage where a check in code decides whether a sentence is
about training. Anyone reading the phase report should take "the coach stays on
topic" as _defence in depth that works against ordinary misuse_, and take the
following as the actual guarantees:

| Claim                                             | Status                                                     |
| ------------------------------------------------- | ---------------------------------------------------------- |
| The chat cannot read another user's data          | **Guaranteed** — no tool, no query, RLS underneath         |
| The chat cannot write anything                    | **Guaranteed** — no write path exists                      |
| The chat cannot change a number the app shows     | **Guaranteed** — those come from `src/metrics/`            |
| A refusal's wording cannot be altered by the user | **Guaranteed** — it is a constant                          |
| The reply states no unverifiable figure           | **Enforced** — guard, retry, then a code-owned message     |
| The chat only ever discusses training             | **Mitigated, not guaranteed** — a model classifying itself |

A jailbroken chat's realistic worst case is that a user who worked at it gets a
non-training answer, and pays for it out of their own weekly budget. That is a
cost and a quality problem. It is not a data problem, and the report must not
blur the two.

## Consequences

- `LlmStage` gains `chat`, which means a model array, a token budget, and a row
  in `llm_calls` per message — invariant #3 applies, so a blocked or refused
  message is still a logged call.
- The number guard makes the coach vaguer than a general assistant would be. It
  will say "your top set has moved up" where a chatbot would say "up 7.5 kg".
  That is the intended trade and users should not be surprised by it, so the
  surface says so.
- `findInventedNumbers` is now a thin caller of `findUnknownNumbers`. The
  persona's behaviour is unchanged and its tests are the proof of that.
- The adversarial suite grows by a case class it did not have: **multi-turn**.
  Every earlier case was a single payload in a single field.

## Notes

The plan-reveal control on the coach page is not a security measure and is not
claimed as one — it is there because a plan appearing unasked is the wrong
default, and it is documented in `docs/specs/coach-chat.md` rather than here.

This ADR was drafted as 0014 in the phase-5 plan; 0014 was taken by the exercise
progression chart while this branch waited.
