# ADR 0031 — Talking to the coach mid-session, and what it is allowed to cost

**Status:** accepted, rework
**Date:** 2026-09-12

## Context

The coach lives on its own tab. During a session your hands are chalked, your
phone is on the floor, and you have ninety seconds — which is exactly when a
question arrives and exactly when typing one is least likely.

So: a **hold-to-talk** button on the session screen. Hold, speak, release; the
coach answers in the chat, and — if you asked it to — aloud.

Two things make this an ADR rather than a component. It is the **first input
channel that is not typed**, and it is the first feature that can spend the
project's whole weekly key in one session.

## Decision

### 1. Recognition is the browser's, not a provider's

The owner chose `SpeechRecognition` over a paid speech-to-text stage.

- Free, no key, no new `llm_calls.stage`, no migration, no budget assumption —
  which matters against a key funded in single dollars.
- It is the mirror image of [ADR 0025](0025-coach-voices.md), and deliberately
  so: that ADR killed device speech for OUTPUT because **a device voice cannot
  be a character**, and character is the whole product. Recognition has no
  character to get wrong. The argument that applied to output does not apply to
  input.

**It does not exist in iOS Safari.** This is a phone-first product, so that is a
real hole rather than a footnote.

**Where it is missing, the button is not rendered and a text box is.** A control
that does nothing is worse than an absent one, and
`docs/specs/mobile-interface.md` §4 wants every state to say something: the card
explains that this browser cannot listen and gives the same conversation a
keyboard. Nobody loses the feature; they lose the microphone.

### 2. The server never speaks text the browser sends

[ADR 0025](0025-coach-voices.md) §4 settled this and it is what shapes the
request. A user who could POST arbitrary text to the speech stage could make the
project's key say anything, bounded only by the budget.

So the reply is generated and spoken **in one request**: the action calls
`askCoach`, takes the answer it returns, and passes **that** — server-side text,
never round-tripped — to `callSpeech`. The browser receives audio and a
transcript together. There is no path where the browser hands the server words to
say.

The slug naming the VOICE may come from the browser, exactly as `hearCoach`
allows, because it selects among shared rows and cannot change what is said.

### 3. Speaking is opt-in, per session

**Chosen by the owner, and the reason is arithmetic.** A spoken reply is one
speech call at `SPEECH_ASSUMED_COST_USD` — $0.02 — against a default budget of
$0.50 a week. **Twenty-five spoken replies spend a week.** A chatty session is
twenty-five presses.

- The toggle is **off by default**, and a feature that can spend the entire key
  in one session is not a default.
- It is **per session**, held in component state: it does not persist, because a
  choice that quietly survives into next week is how somebody spends the budget
  without deciding to.
- It sits **on the session card beside the talk button**, not in Settings. The
  cost of opt-in is a user who never finds the toggle and never hears a coach,
  and ADR 0025 exists because being heard is the point.
- The card says what it costs **in words** — "the coach's voice costs the app
  money" — never in dollars. The money is the project's and the figure is not the
  user's business.

**The button works with the toggle off.** You still get the answer, in the chat,
for the price of a chat call. Only the audio is behind it.

### 4. Only a reply that fits the existing bound is spoken

`SPEECH_ASSUMED_COST_USD`'s own AI-NOTE says it is _"sized for a sample line and
nothing longer"_, and that a PR speaking something longer _"must replace this flat
figure with one that scales with what is spoken, before it ships"_.

This PR speaks chat replies, which the schema caps at 700 characters — two and a
half times a sample line. So that note is addressed rather than ignored, and the
cheaper of the two answers is taken:

**A reply is spoken only if it fits `MAX_TRANSCRIPT_CHARS` (280), the bound the
assumption was calibrated against.** Longer replies are shown and not spoken, and
the card says so.

- The assumption stays **exactly true by construction** rather than being
  re-derived, and no migration, no per-row length column and no change to
  `llm_spend_summary` is needed.
- It costs little in practice: `CHAT_SYSTEM` already instructs "two or three
  sentences", which is 150–250 characters. The bound bites on the replies that
  were already too long to want read aloud between sets.
- **Nothing is truncated.** A reply cut to fit would be a reply whose meaning
  changed to save two cents — the mistake `MAX_CLAIM_CHARS` records the evidence
  rows making.

_The other answer — a cost that scales with characters — is the right one when a
delivered plan is read aloud, because a plan cannot be shortened to fit. That is
a different PR and it needs a column._

### 5. The voice is the default coach, and it is named on the card

There is **no stored persona choice** — `users` has no such column, and the Coach
tab's picker is component state that dies with the page. So the session coach
speaks as the first persona alphabetically, which is the same coach the Coach tab
opens with, and the card says whose voice it is rather than leaving the user to
wonder.

_Persisting the choice is a column and a settings control, and it belongs with
whatever change wants it on more than one screen. Guessing here would have been
inventing a preference the user never expressed._

### 6. Confinement is unchanged

The transcript is a message like any other: parsed, fenced, routed, and guarded
by whichever route the model names — [ADR 0015](0015-coach-chat.md) end to end.
The `off_topic` constant answers a question about the weather here exactly as it
does on the Coach tab. Memory applies too: a session turn may leave a note, under
[ADR 0030](0030-what-the-coach-remembers.md)'s rules and no others.

## What this does not guarantee

- **That the transcript is what the user said.** Recognition is a model too. A
  misheard question is answered as asked, and in a gym — plates, music, other
  people — it will be misheard. So the transcript is rendered in the chat as the
  user's own turn, beside the answer it produced: they can see what was heard,
  and say it again when it was wrong. Showing it for confirmation BEFORE sending
  was considered and rejected — a confirm step between every question and every
  answer is most of the reason not to type in the first place.
- **That anyone hears a coach at all.** Opt-in plus iOS Safari means the default
  experience of this feature is a text box and a silent answer. That is the
  trade the budget forced, written down rather than discovered.
- **That the cost estimate is right.** It is an assumption, not a measurement —
  the provider returns no price. §4 keeps it honest by bounding what is spoken
  rather than by improving the estimate.

## Consequences

- The session screen gains a client component and one server action. No new
  stage, no migration, no new `llm_calls.stage` value: this is the chat stage and
  the speech stage, in one request.
- A browser without `SpeechRecognition` gets a strictly smaller feature and is
  told so.
- `SPEECH_ASSUMED_COST_USD` survives unchanged, and its AI-NOTE now has an answer
  rather than an open question.
