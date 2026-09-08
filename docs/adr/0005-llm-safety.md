# ADR 0005 — Injection, conduct and abuse: five layers, four of them code

**Status:** accepted, phase 2 (cross-cutting)
**Date:** 2026-09-01

## Context

Every stage of the pipeline sends text to a model and shows the result to a
user. Three failure classes come with that, and PLAN.md's cross-cutting section
requires a taxonomy of what got through — not just what was blocked.

**Injection.** `workouts.notes` is free text the user writes and the coach will
eventually read. `exercises.name` and `.instructions` come from a third-party
catalogue nobody on this project reviewed line by line. Both currently carry an
`AI-NOTE` warning not to interpolate them into a system prompt. A comment is not
a control: nothing fails if someone does.

**Conduct.** The persona layer ships a Rival and a Sergeant. _True as of
2026-09-08; when this ADR was written the Sergeant was planned and the Old
Master shipped in its place, so this sentence described an intent for eight
days. It is also now the app's only `crude` row, at intensity 5, which is the
combination the paragraph below was written about._ Personas are rows
containing a `system_prompt` — a column, therefore data, therefore a channel.
The realistic harm in a fitness app is not exotic: it is a coach telling a
beginner they are fat, lazy or pathetic, or drifting onto a protected attribute
that a strength coach has no business discussing at all.

**Abuse of the app as a general model.** A metered LLM behind an unmetered form
is somebody else's free chatbot unless something stops it.

The architecture already answers a related question — invariant #1 puts every
number in deterministic code because a model asked for one will sometimes be
fluently wrong. The same reasoning applies here and gives the same answer.

## Decision

**Five layers. Only one of them is a prompt, and it is the weakest one.**

### 1. Untrusted text never enters the instruction channel — structural

`CallOptions.system` is static per stage and `messages` carry everything
per-call. That split already exists for cache reasons; it is now also the
injection boundary, and it is enforced rather than advised:
`tests/unit/invariants.test.ts` fails if any `system` string in the codebase is
built by interpolation.

This is the only layer that is a guarantee rather than a mitigation. Text that
never reaches the instruction channel cannot instruct.

### 2. Untrusted text is fenced and sanitised before it is sent — code

`fenceUntrusted()` wraps a value in a labelled delimiter and states in the
surrounding text that the content is data. `sanitizeUntrusted()` first removes
what makes fences escapable: control characters, zero-width and
bidirectional-override characters, and any sequence resembling the fence itself.
Length is capped, because a long enough payload pushes the real instructions out
of attention.

Zero-width characters matter more than they look. `ig​nore previous
instructions` defeats a naive string check and reads normally to the model.

### 3. A conduct preamble on every stage — prompt, and therefore not a guarantee

`SAFETY_PREAMBLE` is prepended to every system prompt by the gateway, so a new
stage cannot forget it. It states the domain boundary, that content inside
fences is data, and the conduct rules.

It is first in the string, which means it is inside the cached prefix and costs
almost nothing after the first call.

**It is defence in depth and nothing more.** A model that ignores every word of
it is stopped by layers 1, 2 and 4, and the phase report must not present a
prompt instruction as a control.

### 4. Output is scanned before the user sees it — code

`scanOutput()` runs on every completion inside the gateway. It blocks on:

- **Protected attributes.** Race, ethnicity, religion, nationality, gender
  identity, sexual orientation, disability. _Any_ mention, not just hostile
  ones.
- **Demeaning body language** — the realistic conduct failure here.
- **System-prompt leakage** and credential-shaped strings.

A block is retryable: the model is told what happened and asked again, exactly
as a schema failure is. Surviving the retry cap fails the call rather than
degrading to unchecked output.

**Why "any mention" rather than a slur list.** A strength coach writing a
training block has no legitimate reason to reference a protected attribute at
all. That turns an impossible problem — enumerate every slur, in every language,
including tomorrow's — into a tractable one: flag the _topic_. In this narrow
domain the false-positive rate is near zero, and it catches hostile and
well-meaning references alike, which a slur list does not.

**What it does not do, stated plainly.** It cannot detect coded language,
dogwhistles, novel slurs, or bias expressed entirely through neutral vocabulary
— a plan that is subtly worse for one group would pass every check here. This
layer is a backstop against the crude and obvious. It is not a claim that the
system is unbiased, and no report may describe it as one.

**Why no slur list is embedded.** Such a list ages badly, is trivially evaded by
one substituted character, and would put the terms themselves in a repository
that is submitted coursework. The topical guard covers the realistic surface.
`AI-NOTE` in `safety.ts` says how to add one if a beta needs it.

### 5. An adversarial suite that grows every phase — tests

PLAN.md has required this from phase 0 and it stood at zero after two phases.
It starts here with injection, jailbreak, conduct and leakage cases, and the
report records what **got through**, not only what was blocked.

### A blocked call is still a call

`llm_calls.status` gains `safety_blocked`, alongside `budget_denied`. Tokens
were spent, so the row exists — invariant #3 — and the adversarial taxonomy is
countable from the ledger rather than reconstructed from memory.

## Consequences

- Every stage pays the preamble once per cache lineage and a few microseconds of
  regex per completion.
- A false positive is a failed call, not a wrong answer shown to a user. That is
  the right way round for this domain: a coach that occasionally says "I could
  not answer that" is better than one that occasionally insults someone.
- The protected-attribute guard will block legitimate output if the product ever
  grows a feature that needs those topics. It should not, and if it does, this
  ADR is where the exception is argued rather than quietly deleted.
- Layer 1 constrains phase 3: a persona's `system_prompt` column is data written
  by whoever seeds the row. It is prepended as a persona _description_ inside
  the fenced, per-call half, never concatenated into the stage's system prompt.

## Notes

The diet advisor's calorie floor (invariant #6) is a separate control and is not
weakened or replaced by anything here. Clamping in code remains the mechanism;
these layers sit on top of it.
