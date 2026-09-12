# ADR 0030 — What the coach may remember, and who decides

**Status:** accepted, rework — amends [ADR 0015](0015-coach-chat.md) §1 and its
guarantee table
**Date:** 2026-09-12

## Context

The coach forgets everything between messages. Tell it your shoulder is sore on
Monday and it has no idea on Tuesday; say you want to bring up your biceps and
you have to say it again every time. That is the complaint the owner raised about
the box, and it is a fair one: a coach that cannot remember what you told it is
not a coach.

**The obstacle is not technical.** [ADR 0015](0015-coach-chat.md) §1 says the
chat stage has **no database write path**, and its guarantee table lists that as
what makes _"a jailbroken chat cannot persist anything"_ true rather than
hopeful. Memory needs a write path. So this cannot be built without weakening a
stated guarantee, and the honest thing is to say which one, by how much, and what
replaces it — in the table itself, not in a footnote.

## Decision

**The model proposes a sentence. Code decides whether it is stored. The user can
delete it.**

Put to the owner as three options, with this one recommended and chosen.

### 1. The note is a field, not a tool

The chat stage returns one more field beside `route` and `reply`: `remember`, a
short sentence the model thinks is worth keeping, or the empty string.

It is a **field rather than a tool** because a tool is a write path and a field
is a suggestion. Nothing the model emits reaches the table. What reaches the
table is what `askCoach` returned after checking it, written by
`app/coach/actions.ts` under the caller's own session, with `user_id` from that
session and never from a field.

**The empty string is the sentinel, not `null`** — the same reasoning
`supplement_slug` carries. A nullable field is a second way to say nothing, and
two ways to say nothing is a branch nobody tests.

**It is declared last.** `route` is first so the model commits to a
classification before writing an answer (ADR 0015 §3); `remember` is last because
deciding what was worth keeping is a judgement about an answer that has already
been written.

### 2. What code checks, and what it does not

A proposed note is **dropped** unless all of:

- it is non-empty after trimming;
- it is **at most 120 characters** — a sentence, not a paragraph;
- it contains **no numeral at all, in any script** (`\p{N}`, the diet route's own
  predicate). A remembered figure is a figure the metrics engine did not produce,
  and it would be re-fed to the model every turn as though it had. "Reported a
  sore shoulder" is a memory; "squats 100 kg" is an invented fact with a long
  life;
- it contains **no figure spelled out with a training unit on it** — "two
  hundred kilos", "five sets". _FOUND IN REVIEW: "no numeral" is not "no figure",
  and the first version of this ADR said it was. A spelled figure passed every
  check, and neither reply guard would catch the model restating it later,
  because both of them read numerals. The **unit** is the boundary, exactly as it
  is for `CALORIE_FIGURE`: a bare "squats two hundred" is not matched, and
  neither is "wants one more session a week", which is a memory worth keeping.
  **English only** — a number-word list per language is the shape `scanOutput`
  declines for slurs, for the same reason._;
- it is not a duplicate of a note already held, compared case-insensitively on
  collapsed whitespace **after invisible characters are stripped**. Without the
  duplicate rule the model re-proposes the same sentence every turn and twenty
  slots become one fact twenty times. _Without the stripping the rule did not
  work at all: a zero-width space is not whitespace to `String.trim` and is not
  matched by the whitespace class, so one appended character defeated it — and
  `sanitizeUntrusted` strips them again on the way into the prompt, so the model
  would have read twenty identical lines. The rule's own failure producing the
  outcome the rule prevents. FOUND IN REVIEW._

**It is taken on two routes only** — `training` and `diet`, where the user is
talking about themselves. An `off_topic` turn's prose is discarded _without being
read_ (ADR 0015 §3) and its note goes with it: a memory harvested from a message
the coach refused to answer is a memory of an attempt to steer it, re-fed on every
turn afterwards. The `supplement` route reads no prose at all. An exhausted guard
loop remembers nothing either, because the user never saw that answer.

**Dropped silently, and never retried.** A bad note must not cost the user their
answer: the reply is what they asked for and the note is a side effect. So a note
that fails any check above is discarded and the reply is returned as normal.

**That promise is unconditional for the checks above, and NOT for the output
scan** below, which runs before any of them.

**`scanOutput` is NOT applied here, because it has already run.** Since
[ADR 0005](0005-llm-safety.md)'s 2026-09-12 amendment the gateway scans every
string leaf of the parsed value, and `remember` is one — so an unsafe note fails
the whole call, is corrected and is retried, before any of this code runs. That
is a real consequence of adding the field and it is the right one: the note
channel cannot be used to get text past layer 4 that `reply` could not. It is
stated here rather than reimplemented, because a second scan would look like a
second control and would not be one. Its limits are ADR 0005's, unchanged, and
they include the homoglyph hole that amendment names.

**And it has a cost this ADR first failed to state.** `scanValue` reports a
finding without saying which field it came from, so the gateway cannot drop the
note and keep the reply — it discards the whole attempt, retries to the ceiling
and throws. **A finding whose only site is the note therefore costs the user
their answer, plus three paid attempts.**

The realistic path is not adversarial, which is what makes it serious:
`PROTECTED_ATTRIBUTE` matches `disability`, so a user who says "I have a
disability in my right shoulder" invites a model that writes that into
`remember` — and gets three blocked attempts and a generic error with no
explanation. A new denial path aimed at exactly the users the conduct rule exists
to protect. FOUND IN REVIEW.

Mitigated in the prompt, which is not a control: the model is told to record what
the user can and cannot do and never why, and told what it costs them if it does
otherwise. **The real fix is per-leaf attribution in `scanValue`**, so the
gateway can drop a dirty note and keep a clean reply. That is a change to ADR
0005's layer 4 and is not made here.

A finding's matched text, up to 80 characters, also reaches `llm_calls.error` via
`describeFinding` — health-adjacent free text in a column, RLS-scoped to the same
user, and the same treatment `reply` has always had.

### 3. Bounded at twenty, in two places

At most **twenty notes, newest kept**. An unbounded memory is three problems:

- **a cost leak** — every note is re-sent on every turn;
- **an attention-dilution attack** — ADR 0015 §5's argument for the transcript
  window, one table along;
- **a list nobody can audit**, which makes the deletion control decorative.

The **reader takes the newest twenty**, which is what bounds the prompt, and a
**trigger** evicts beyond twenty, which is what bounds the table and the list on
Settings. The reader's limit is the control; the trigger is hygiene that also
holds for a row written by any other means, which the RLS policy permits. A bound
enforced only by the one caller is a bound until the second caller.

### 4. The user can see and delete every note

On **Settings**, beside Equipment.

_The plan said Profile. Settings is where [ADR 0013](0013-profile-and-hub.md)'s
amendment moved this class of control, and where the equipment picker already
lives: a thing you manage about yourself, rather than a thing you have earned.
Profile is the long page, and a control at the bottom of it is a scroll target._

This is not a nicety. It is what makes the weakened guarantee acceptable, and it
is why the amended table says the memory is **user-removable** rather than merely
bounded.

## The guarantee that changes

ADR 0015's table gains a row, and one of its rows is narrowed:

| Claim                                             | Before                                     | After                                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The chat cannot write to the user's training data | **Guaranteed** — no such write path exists | **Guaranteed** — unchanged. `coach_notes` is not training data: nothing reads it but the prompt builder, and no metric, plan or figure depends on it |
| The chat cannot persist anything                  | **Guaranteed**                             | **No longer true.** It can persist one short sentence per turn, which code validated and the user can delete                                         |

**Weaker, honestly weaker.** What replaces it is not "trust the model": the model
cannot choose the length, cannot write a numeral in any script nor a spelled
figure carrying a training unit, cannot repeat itself into the whole budget,
cannot exceed twenty, and cannot keep anything the user removes.

## What this does not guarantee

- **A jailbroken turn now lasts longer than a turn.** Said as bluntly as ADR
  0015 §7 says it, because this is the document a report will quote: an
  instruction-shaped sentence that survives every check — "wants to be pushed
  hard regardless of soreness" — becomes standing context that outlives a cleared
  transcript and a new device. What bounds the damage is elsewhere and is
  unchanged: the diet floor is clamped in code (invariant #6), notes enter no
  quotable set, and the user can delete any of them.
- **The coach will remember the wrong thing sometimes.** Which sentence is worth
  keeping is the model's judgement — the same class as `route`, and a mitigation
  rather than a control.
- **Two turns at once can store the same note twice.** Both compare against the
  same pre-turn snapshot. A lock would cost more than the duplicate does.
- **A note records a claim, not a fact.** "Reported a sore shoulder" is what the
  user said. The conduct rule about injury still outranks it, and a note must
  never be read as a diagnosis.
- **Notes contribute nothing to the quotable number set**, for the reason coach
  turns do not: a figure that slipped into a note once would otherwise license
  itself forever. The numeral rule makes this belt and braces rather than the
  only thing standing there.

## Rejected

**Free-form model memory** — a tool the model calls with arbitrary text. Deletes
the guarantee outright rather than narrowing it, and makes every jailbreak
durable instead of lasting one turn.

**A confirmation tap per fact.** Preserves the guarantee almost intact, and was
judged to cost more than it buys: a coach that forgets what you told it because
you did not tap yes is a coach nobody trusts. The deletion control is the same
power, exercised by the people who want it rather than by everyone.
