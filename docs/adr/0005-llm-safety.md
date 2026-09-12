# ADR 0005 — Injection, conduct and abuse: five layers, four of them code

**Status:** accepted, phase 2 (cross-cutting) — amended 2026-09-11: the speech
stage is exempt from §3 and §4, see [ADR 0025](0025-coach-voices.md); amended
2026-09-12: §4 scanned an encoded document, see the amendment below
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
Master shipped in its place, so this sentence described an intent for seven
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

_One stage has none: `speech`, since 2026-09-11, because a speech model would
read the preamble aloud. [ADR 0025](0025-coach-voices.md)'s addendum records
what stands in for it._

It is first in the string, which means it is inside the cached prefix and costs
almost nothing after the first call.

**It is defence in depth and nothing more.** A model that ignores every word of
it is stopped by layers 1, 2 and 4, and the phase report must not present a
prompt instruction as a control.

### 4. Output is scanned before the user sees it — code

`scanOutput()` runs on every completion inside the gateway. _It runs a second
time on the parsed value's string leaves — the 2026-09-12 amendment at the foot
of this file, which is where the paragraphs below stopped being the whole story._ _A speech call
returns audio, not a completion, and is not scanned; what it speaks is stored
text that a test holds to `scanOutput` — [ADR 0025](0025-coach-voices.md)'s
addendum._ It blocks on:

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

---

## Amendment, 2026-09-12 — layer 4 read an encoded document

**Found by probe while designing coach memory, not by the adversarial suite,
which is the part worth recording.** It then took two attempts, and the first
one's failure is kept here because it is the more instructive half.

### The hole

`scanOutput` ran on `content` — the raw completion string — and it ran there
deliberately: §4 said "before anything is parsed or returned", because a
response that is not valid JSON still reaches a log and still had to be checked.
That is a good reason and it produced a bad order. Every stage in this project
asks for structured output, so `content` is a JSON **document**, and a JSON
document may spell any character as an escape.

```
{"route":"training","reply":"you are \u0067ay","supplement_slug":"__none__"}
```

`scanOutput` on that string finds nothing. `JSON.parse` then yields
`you are gay`, which is what the user reads.

This is not one guard's blind spot. It is all four — protected attribute,
demeaning, prompt leak, credential — and it is available to anything that can
influence how the model spells its answer, which on the chat stage is a fenced
message from the user. Layer 4 is one of the four layers this ADR calls code
rather than prompt, so "a determined prompt gets past it" was the one thing it
was not allowed to be.

**It was open from phase 0 until 2026-09-12.**

### The first fix was wrong, and two reviewers measured it

The first version scanned `JSON.stringify(parsed)` and justified itself with
the sentence _"every escape has become the character it denotes and
`JSON.stringify` re-emits it literally"_. **That sentence is false.**
`JSON.stringify` decodes `\u0067` into `g`, and then RE-ESCAPES `"`, `\\`
and the whole C0 range. A real newline comes back out as two ordinary
characters: a backslash and an n.

Every pattern in `safety.ts` joins its words with `\s+`, and `scanOutput`
normalises control characters to a space **precisely so** a line break cannot
split a phrase — a normalisation that never fires on a re-escaped one. So:

```
{"summary":"you are\nfat"}     → reached the user, through the "fix"
```

One character cheaper for the attacker than the case the fix was written for,
and the same insult on screen. Both reviewers ran it end to end through
`callLLM` rather than reasoning about it, and the case is now in the suite.

### What ships

`scanOutput` still runs on the raw string, unchanged, for the reason §4 gave.
**`scanValue` then walks the parsed value's string leaves and scans each one on
its own.** A finding from either is the same `safety_blocked` status, the same
correction and the same retry; the caller cannot tell them apart.

- **Leaves, not the document.** The document is the encoded form, which is the
  whole finding above.
- **A structural walk, not a list of field names.** A schema gains a field more
  often than anyone remembers to widen such a list, and a new field is covered
  here by being a string.
- **Each leaf separately, never joined.** Joining would let the separator
  manufacture a match across two fields that neither field contains — a false
  positive that fails a call for a user who did nothing.
- **Keys are not scanned.** They are text the schema chose rather than text a
  model wrote.
- **A blocked response that was also truncated is not retried.** The MEASURED
  rule for truncation applies with more force here, not less: a correction makes
  the request longer against an unchanged `max_tokens`. The value is refused
  either way; this decides only whether the refusal is paid for three times.

### What still gets through, named rather than implied

§4's existing disclaimer covers coded language, dogwhistles, novel slurs and
bias in neutral vocabulary. It does **not** cover these two, so they are stated
here in their own words, and both are **passing tests in the adversarial suite**
that assert the hole:

- **Homoglyphs and character substitution.** `g\u0430y` (Cyrillic а),
  `\uFF47ay` (fullwidth g) and a combining accent all reach the user. This is
  now the cheapest remaining bypass. Closing it means NFKC plus a confusables
  table, which is a decision — a wrong one starts rejecting ordinary text — and
  not a patch to make in the same change as this one.
- **A phrase split across two fields.** Each leaf is scanned alone, so
  `{"a":"you are so","b":"weak"}` matches nothing. Not reachable to any effect
  today, because on every stage here the prose is one field and the rest are
  enums; a schema with two prose fields would make it reachable, and that is the
  moment to revisit the no-joining rule.

### Consequences

- A model that deterministically re-emits a blocked answer now costs three
  attempts where it used to cost one. That is the correct failure — the call
  fails rather than degrading to unchecked output — but it is a **3× cost
  multiplier a chat user can trigger against their own weekly budget**, and the
  budget is what bounds it.
- The correction feeds the rejected attempt back in its raw, still-escaped form,
  fenced and sanitised by `rejectedAttempt`. A model steered by an injected
  "spell your reply with escapes" will re-emit and burn the cap. Failing closed
  is right; paying three times for it is the price.
- **The adversarial suite gains this class**, per §5, recorded as a hole that
  existed rather than as a case that always passed.
