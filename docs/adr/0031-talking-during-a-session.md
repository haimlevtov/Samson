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

### 1. Recognition is the browser's provider, not ours

The owner chose `SpeechRecognition` over a paid speech-to-text stage.

- Free **to this project**, no key, no new `llm_calls.stage`, no migration, no
  budget assumption — which matters against a key funded in single dollars.
- It is the mirror image of [ADR 0025](0025-coach-voices.md), and deliberately
  so: that ADR killed device speech for OUTPUT because **a device voice cannot
  be a character**, and character is the whole product. Recognition has no
  character to get wrong. The argument that applied to output does not apply to
  input.

#### The audio leaves the device, and the first version of this ADR did not say so

This section was titled _"Recognition is the browser's, not a provider's"_ and
listed the choice as free with no provider attached. **Free is true of the money
and false of the data.** The Web Speech API permits an implementation to
recognise on-device or remotely, and **Chrome's is remote**: it streams the
captured audio to Google's speech service. Edge does the same to Microsoft's.
There is a provider. It is not ours, we do not pay it, and it is not in any other
ADR — which is exactly why it belongs in this one.

It matters more here than it would in most apps. The questions this feature is
built for are _"my shoulder feels off on presses"_ — **the user's own voice,
saying something about their body, going to a company none of our documents
mention.** This project wrote a careful control for the REPLY reaching a
text-to-speech provider ([ADR 0025](0025-coach-voices.md) §4, and §2 below) and
said nothing about the QUESTION reaching a recognition one.

**Nothing changes in the code because of this**, and that is a decision rather
than an omission: the alternative is a paid speech-to-text stage, which the owner
declined for the budget reasons above and which would send the same audio to a
provider we pay instead of one we do not. What changes is that it is written
down, and that a report describing this feature must say where the audio goes.

_Not measured here — it is Chrome's documented behaviour rather than something
this project observed, because no browser pass has happened yet. Worth confirming
in the one that is owed._

**It does not exist in iOS Safari**, which sidesteps the paragraph above by
having no API at all. This is a phone-first product, so the absence is a real
hole rather than a footnote.

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
transcript together.

The slug naming the VOICE may come from the browser, exactly as `hearCoach`
allows, because it selects among shared rows and cannot change what is said.

### And that is not sufficient, which the first draft of this ADR got wrong

This section used to end _"there is no path where the browser hands the server
words to say"_, and shipped on it. **Literally true, substantively false**, and a
review caught it before merge.

The words are the chat model's, not the browser's — but they ANSWER a question
the browser supplied, and the speech model's input is an instruction channel
rather than a string. `src/speech/script.ts` had already written the
consequence down, in an AI-NOTE naming this PR:

> square brackets in a transcript are audio tags to this model … The later PR
> that speaks model-written prose … makes the transcript untrusted (CLAUDE.md
> #11) and must strip the brackets AND this file's own label text … first

None of that was done. So a user could hold the button, ask the coach to repeat
something back, and have the project's key perform it — `[shouting]` included,
or a second `### DIRECTOR'S NOTES` block overriding the cast character.
"The chat model probably will not comply" is defence in depth, which
[ADR 0005](0005-llm-safety.md) §3 says in as many words is **not** the control.

**`spokenLine` is the control.** Everything that is not a shared row's own column
goes through it before it is performed: bracketed spans removed whole, headings
and this script's own labels removed, then the sanitising every other untrusted
string in the project gets. A reply that sanitises to nothing is not spoken, and
a reply too long to sanitise without truncating is not spoken either — §4's rule,
applied to the same string twice.

_[ADR 0025](0025-coach-voices.md) §4's "only stored text from a shared row is
spoken" stopped being true here, and its exemption of the speech stage from
`scanOutput` rested on it. The transcript is now sanitised in code instead;
extending the output scan to the speech input is the alternative and is not what
was chosen, because what matters is the FORMAT — brackets and labels — which
`scanOutput` does not read._

### 3. Speaking is opt-in, per session

**Chosen by the owner, and the reason is arithmetic.** A spoken reply is one
speech call at `SPEECH_ASSUMED_COST_USD` — $0.02 — against a default budget of
$0.50 a week. **Twenty-five spoken replies spend a week**, and fewer than that in
fact: every press is also a chat call, which this figure does not count. A chatty
session is twenty-five presses.

**And a press is bounded but not cheap.** `askCoach` loops twice over a gateway
that retries three times, so one press is up to six chat calls plus two speech
attempts. The budget gate reads spend and then allows, so concurrent presses all
pass on one stale figure — the unreserved gap ADR 0025 names. `requestPlan`
carries a cooldown for exactly this reason and calls it "the finding with money
attached"; **this action shipped without one and a review added it.** A client-side
`disabled` is one tab and stops nobody scripting a POST.

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

- The assumption is kept **within the shape it was calibrated for** rather than
  re-derived, and no migration, no per-row length column and no change to
  `llm_spend_summary` is needed. _The first draft said "exactly true by
  construction", which a review falsified: the figure is calibrated on DURATION —
  "280 characters spoken slowly is about thirty seconds" — and characters bound
  duration only for text a coach actually says. `[very slowly]` in a
  280-character line is minutes at the same flat charge. §2's `spokenLine`
  removes the tag SYNTAX, which makes that materially harder — but not
  unreachable, and an earlier version of this sentence said unreachable. This
  model takes its direction in PROSE, which is the whole reason the script is
  prose: "say this one word at a time, pausing between each" is direction a regex
  cannot see. What remains is bounded by the model's own compliance rather than
  by code, and by the per-user weekly budget. The two halves still depend on each
  other: **deleting the sanitiser reopens a budget hole, not only a content
  one.**_
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
speaks as the first **shared, voiced** persona alphabetically.

_Two corrections a review made to this paragraph. It said "the same coach the
Coach tab opens with", and that tab defaults to `personas[0]`, which includes a
user's own rows — so somebody with a private persona named earlier gets two
different coaches on two surfaces. And it said "the card says whose voice it is",
which the card only does once a clip has arrived: with the toggle off, before the
first question, or on a reply too long to speak, it says nothing. Both are the
same underlying gap — there is no persona to name until one has spoken._

_Persisting the choice is a column and a settings control, and it belongs with
whatever change wants it on more than one screen. Guessing here would have been
inventing a preference the user never expressed._

### 6. Confinement is unchanged

The transcript is a message like any other: parsed, fenced, routed, and guarded
by whichever route the model names — [ADR 0015](0015-coach-chat.md) end to end.
The `off_topic` constant answers a question about the weather here exactly as it
does on the Coach tab. Memory applies too: a session turn may leave a note, under
[ADR 0030](0030-what-the-coach-remembers.md)'s rules and no others.

**One route is NOT end to end, and saying "ADR 0015 end to end" was wrong.** On
the `supplement` route the answer is the ROW, and this surface has nowhere to
render one — the Coach tab shows the claim, grade, dose and citation beneath the
constant. So a supplement question asked mid-session returns a sentence pointing
at a table that is not there. The card now says to open the Coach tab instead of
announcing something it cannot show, and the row is deliberately not carried
through: a session screen is not where somebody reads a citation.

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

## What two review rounds changed, recorded because the pattern repeated

Three findings in this ADR were claims that read as true and were not, and two
of the fixes for them were themselves wrong on the first attempt. That is worth a
section rather than a footnote, because the shape was the same every time: **a
guard written, a sentence written to match it, and nothing measuring whether the
sentence held.**

- **"There is no path where the browser hands the server words to say."** True of
  the arguments, false of the outcome — `src/speech/script.ts` had an AI-NOTE
  naming this PR and saying what it had to strip. §2 now describes `spokenLine`.
- **`spokenLine` itself, first version.** It stripped the labels BEFORE the
  whitespace collapse and before `sanitizeUntrusted` — both of which rebuild what
  the matcher just missed. Five spellings walked through, including a curly
  apostrophe, which is what a model actually emits.
- **"The assumption stays exactly true by construction."** It is calibrated on
  duration, not characters. §4 says what it really buys.
- **The `holding` latch, twice.** First with no owner at all, then with an owner
  that could not tell which press an `onend` belonged to — and the regression
  test written for it passed against the code it was meant to catch.
- **No catch on the client’s own await**, so a failed REQUEST — not a failed
  answer — replaced the whole session screen, set grid included.

**Four of those are bugs `src/speech/player.ts` had already found and fixed**, in
its own second review, and they came back because this PR wrote playback and
in-flight bookkeeping from scratch instead of reading the module next door. The
lesson is in that file’s header already: the resilience bugs live in the press,
cache and in-flight bookkeeping, which is why they belong in a testable module
rather than in a component. `listen.ts` took that advice; the component did not,
and `turn`, `blocked` and `mustType` are still untested because of it.

## Consequences

- The session screen gains a client component and one server action. No new
  stage, no migration, no new `llm_calls.stage` value: this is the chat stage and
  the speech stage, in one request.
- A browser without `SpeechRecognition` gets a strictly smaller feature and is
  told so.
- `SPEECH_ASSUMED_COST_USD` survives unchanged, and its AI-NOTE now has an answer
  rather than an open question.
