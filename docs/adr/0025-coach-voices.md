# ADR 0025 — A coach speaks in a synthesised character voice, through the gateway

**Status:** accepted, rework plan PR 6b — with an [addendum after the code](#addendum-after-the-code-2026-09-11--what-two-rounds-of-review-of-49-found)
and a [correction after the first live calls](#corrected-after-the-first-live-calls-2026-09-11)
**Date:** 2026-09-11
**Supersedes:** [ADR 0006](0006-persona-boundary.md)'s "there is no TTS provider"
and its device-voice allocation, for coaches. ADR 0006 still governs what a
persona may SAY.

> Written before the code it governs, in its own commit — and corrected before
> that code, in a second one. See [Corrected before the code](#corrected-before-the-code-2026-09-11).
> What review found after the code is in [the addendum](#addendum-after-the-code-2026-09-11--what-two-rounds-of-review-of-49-found).

## Context

PR 6 gave each coach a sample line and a "Hear" button, spoken by the browser's
own `speechSynthesis`. The user's verdict, and the rule this ADR keeps: **a coach
voice that does not fit its personality is useless.**

Measured on this machine's browser, which offers Microsoft David, Mark and Zira
and nothing else, the Sergeant spoke in Zira — a light female voice — at the
highest pitch of the five, and the Analyst and the Physio shared the Old
Master's and the Rival's voices. PR #48 then tried choosing device voices by
kind and shaping them with per-coach pitch and rate. Review showed the ceiling:
three device voices cannot make five characters, and choosing by kind only moved
the collisions. **#48 was closed unmerged.**

The earlier claim that no browser voice could sound like a samurai master was
wrong in the way that mattered. It is true of `speechSynthesis`, which can only
use the voices installed on the device; web products with characterful voices do
not use it. They call a steerable text-to-speech model — one told HOW to speak,
in words — or run a neural voice in the page, or ship pre-rendered clips.

**What changed the options:** OpenRouter, the provider this project already
uses, now serves text-to-speech at `POST /api/v1/audio/speech`, and one of the
models behind it, `google/gemini-3.1-flash-tts-preview`, takes a written
direction for tone, pace and character. So a coach's character can be written
down and spoken, through the key and the gateway the project already has.

## Decision

**A coach's voice is synthesised by a steerable TTS model, from a direction
stored in its row, through the gateway.**

1. **Content in the row** — CLAUDE.md #7. Each persona carries `tts_voice` (the
   model's voice name) and `tts_instructions` (how the character speaks: "An old
   samurai sword master: deep, grave, unhurried…"). Provider-neutral in intent:
   a direction written for a person is what a real-time voice will need too.
2. **Through the gateway** — CLAUDE.md #2 and #3. A `speech` stage, and
   `callSpeech` beside `callLLM` in `src/llm/gateway.ts`: the same weekly budget
   gate, the same retry loop — shorter, see the addendum — and an `llm_calls` row
   for every attempt, failures included.
3. **One model, no fallback model.** A voice name belongs to one model — Gemini's
   `Algenib` means nothing to another — so a fallback would speak in a voice
   nobody cast, which is the mismatch this ADR exists to end. A retry goes to
   the same model.
4. **Known text only, from shared rows only.** The server never speaks text the
   browser sends: this PR speaks a coach's own `sample_line`, looked up by slug.
   And only from a row with no owner — `personas_write` lets a user write their
   own persona row, line and direction included, so reading one would let them
   make the server speak whatever they typed, bounded only by the budget.
   Reading a delivered plan aloud needs the delivery stored server-side first,
   and is a later PR, not yet planned.
5. **No mismatched fallback.** No key, no budget left, or a failed call: the
   coach shows its line as text. It never falls back to a device voice. Device
   speech survives only for persona-less cues — the rest timer's "Rest over."
6. **The device-voice machinery goes.** `tts_voice_id` and `tts_voice_variant`,
   the variant allocation and the voice picker served coaches only; with coaches
   off device speech they have no consumer, so they are removed rather than left
   as columns that describe nothing. **In two steps:** this PR removes every
   reader, and the first migration after it is deployed drops the columns.
   Dropping them in the same push would break the running app, which still
   selects them, for as long as the deploy takes. The drop regenerates
   `src/db/types.ts`, so it needs a local stack once more.

### How the direction reaches the model

Gemini's speech model has no separate instructions field: it reads direction
from the input itself. Google's own guide warns that a vague prompt can make it
read the direction ALOUD, and says to open with a line telling it to synthesise
speech and to label where the spoken transcript begins. So the input is a fixed
preamble, then `DIRECTOR'S NOTES` with the row's direction, then `TRANSCRIPT`
with the line — static first, dynamic last, the same order every stage keeps.

### The characters

Cast from the personas' own descriptions, against Google's one-word descriptions
of its thirty voices:

| Coach          | Voice     | Google's word | Direction, in short                                  |
| -------------- | --------- | ------------- | ---------------------------------------------------- |
| The Old Master | `Algenib` | gravelly      | an old samurai sword master: deep, grave, unhurried  |
| The Sergeant   | `Alnilam` | firm          | a drill sergeant on the parade ground: loud, clipped |
| The Rival      | `Puck`    | upbeat        | a cocky training partner: dry, quick, a smirk in it  |
| The Analyst    | `Erinome` | clear         | a sports scientist: calm, precise, no hype           |
| The Physio     | `Sulafat` | warm          | an experienced physio: warm, gentle, unhurried       |

A voice and a direction are a first draft of a performance. They are tuned by
ear once the key is set, and a tuning is a migration like any other content.

## Cost

`google/gemini-3.1-flash-tts-preview` is billed **$1 per million text tokens in
and $20 per million audio tokens out**, at 25 audio tokens a second — about
**$0.03 per minute** of speech. A sample line is ten to fifteen seconds, so a
preview is about **$0.005 to $0.01**; the longest line the column allows, 280
characters spoken slowly, about $0.016.

**The ledger records no cost for a speech call, and the budget gate charges one.**
OpenRouter returns the audio and a generation id and nothing about price, so a
speech row carries `cost_credits` null and the id, from which the real figure can
be reconciled. `sumSpendSince` then charges each spoken attempt
`SPEECH_ASSUMED_COST_USD`, **$0.02**, the longest line rounded up — the same
split `TIMEOUT_ASSUMED_COST_USD` already makes (ADR 0007): the ledger stays
measured, the gate stays conservative.

So the gateway's default budget of **$0.50 per user per week** allows **25
previews**, and a user who spends it on previews has none left for a plan or the
chat that week. A replay within one visit is free: the page keeps the audio it
already fetched. Automated tests cost nothing — they run against a scripted
gateway with no key, as every stage's do.

**The flat charge is sized for a sample line and no longer.** A delivered plan
read aloud, in a later PR, is a minute or more; that PR has to replace the flat
figure with one that scales with what is spoken.

## What this does not decide, and where it is going

**The end goal is a coach that talks to the user live, mid-workout.** That is a
real-time speech-to-speech session, not this: CLAUDE.md puts real-time work out
of scope today, and nothing here builds it. What this ADR does is put each
coach's voice DIRECTION in the row, in words, so that session can reuse it
rather than start again.

Not decided: caching audio server-side (a replay on a later visit costs a second
call until it is), and pre-rendered clips.

## Consequences

- **It speaks only once `OPENROUTER_API_KEY` is set**, in `.env.local` and on
  Vercel — the same condition as the other stages listed as blocked on the key.
  Until then the Voice card shows each line as text.
- A preview costs a network round trip, a few seconds, where device speech was
  instant. The button says so while it waits.
- **The model is a preview.** Google can retire it. When it goes, every coach's
  `tts_voice` has to be recast against the replacement's voices in one
  migration, because of decision 3.
- Adding a coach now means writing a voice direction, and the add-persona skill
  says how.

## Corrected before the code, 2026-09-11

The first version of this ADR named **`openai/gpt-4o-mini-tts`**, with OpenAI's
`onyx`, `ash`, `verse`, `sage` and `coral` voices, a separate `instructions`
field for the direction, and about $0.002 a preview. OpenRouter's speech guide
uses that model in its example, which is where it came from. **It is not in
OpenRouter's catalogue**: checked on 2026-09-11 against
`/api/v1/models?output_modalities=speech`, which lists eighteen speech models
and no OpenAI one, and its endpoints lookup answers 404. A stage built on it
would have failed on its first call.

Of the models that are listed, `google/gemini-3.1-flash-tts-preview` is the one
steered by a written direction and offering enough distinct voices for five
characters. So the model, the voices, how the direction is carried and the cost
above are the corrected ones. The decision — a direction in the row, spoken
through the gateway, no mismatched fallback — did not change.

The first version also said the per-character price would be "estimated in code"
without saying where the estimate goes. It goes in the budget gate, never in a
row, for the reason `TIMEOUT_ASSUMED_COST_USD` gives.

## Addendum after the code, 2026-09-11 — what two rounds of review of #49 found

Recorded after the code, at the reviewers' prompting. The first three points,
and the failed-row and null-token parts of the seventh, were decided in the code
commit and belonged here before it; the rest were decided in answer to review,
and written here before their code.

- **The speech stage is exempt from ADR 0005 §3 and §4.** `callSpeech` sends no
  `SAFETY_PREAMBLE`, because a speech model would read it aloud, and runs no
  `scanOutput`, because what comes back is audio rather than a completion. What
  stands in for both is decision 4: only stored text from a shared row is
  spoken, and `tests/db/personas.test.ts` holds every shipped line to
  `scanOutput`, to no numeral and to none of its coach's banned phrases. The
  later PR that speaks a delivered plan changes that — its transcript is
  model-written from the user's own notes, so untrusted (CLAUDE.md #11) — and
  must strip audio tags and this script's own labels before speaking it.
- **One assertion throws before a call exists, and writes no `llm_calls` row**:
  an input over `SPEECH_MAX_INPUT_CHARS` (1,200; the column limits allow 1,104
  at the most, so nothing reaches it). It comes before the budget gate, so
  nothing is sent or charged, and the gateway reads CLAUDE.md #3's "every call"
  as beginning there — **a reading the owner of CLAUDE.md may refuse**. _The code
  commit had a second, for no speech model configured; the model is now the
  constant `SPEECH_MODEL` and cannot be missing._
- **Retries are shorter than a text stage's**: two attempts of twenty seconds,
  where a text stage gets three of sixty by default. A preview is a button
  press. And `LLM_MODELS`, which swaps text models for an eval run, never
  reaches a speech call — it would recast every coach.
- **Only mp3 is audio, and nothing after a 200 is retried.** _Corrected after
  the first live calls: the model answers only in PCM, so read "the format asked
  for" wherever this says mp3 — see the last section._ A 200 labelled
  anything but `audio/mpeg` (or its alias `audio/mp3`), a 200 with no bytes, or
  a 200 whose body fails mid-read is recorded `schema_invalid`, is not retried,
  and is charged `SPEECH_ASSUMED_COST_USD` like a success: it reached a 200 and
  may have been billed, so one charge per press rather than none, and never two.
  If the timer runs out during that read, the attempt is recorded `timeout`
  instead — charged `TIMEOUT_ASSUMED_COST_USD`, and not retried either.
  The browser is handed the constant `audio/mpeg`, never the provider's header.
  The code commit accepted any `audio/` type, so a model ignoring
  `response_format` would have cached an unplayable clip for every coach.
- **A ledger row's text is made storable at the one writer.** Postgres refuses a
  NUL in `text`, and half a surrogate pair — which a 500-character cut can
  leave — so `openLedger` cleans both, and caps the length, in every field the
  provider can fill (`error`, `model_used`, `openrouter_id`), for every stage.
  Found in the second round: a wrong-format audio body read as text carried
  NULs, the insert failed, and the call it was written to charge went
  unrecorded. A body that is not text is now described, not quoted.
- **A replayed clip and a failed URL on the card.** The Voice card's fetching,
  cache and in-flight presses live in `src/speech/player.ts`, injected and
  tested: one press pays for a clip, a second press joins the call in flight,
  a cached replay supersedes a fetch still coming, a clip that will not play
  is dropped so the next press fetches again, and a clip that cannot be turned
  into a URL is a failure the card shows, not a press left on "Finding…".
- **What the gate charges, completely.** A speech attempt that reached a 200,
  $0.02; a timed-out one `TIMEOUT_ASSUMED_COST_USD`, $0.05, as for every stage,
  so a press that times out twice counts $0.10; an `http_error` attempt — no 200
  came back — nothing. A negative `cost_credits` counts as zero and one that is
  not a finite number as unlimited, and the gate denies a spend or a budget that
  is NaN: `numeric` accepts 'NaN', and every comparison with it is false. The
  token columns are null as well as the cost. And the gate reads the spend before
  the call and the row lands after it, so presses sent at once all pass — the
  unreserved gap ADR 0015 §5 and ADR 0024 already name.
- **The budget has holes older than this ADR**, found by the security review and
  not closed here. A user can raise their own `llm_weekly_budget_usd` (the
  `authenticated` role has table-wide UPDATE on `users`); can insert their own
  `llm_calls` rows with a negative or NaN cost or a `created_at` in the future;
  can bury real spend under a thousand planted rows, because `sumSpendSince`
  sums in JavaScript what PostgREST returns, and PostgREST stops at 1,000; and an
  account with no profile row is charged against the default budget while its
  ledger inserts fail — after the paid call. The budget is the one thing bounding
  speech, so these close in rework plan PR 6c, **before `OPENROUTER_API_KEY` goes
  on Vercel — Production and Preview alike**, as the README's deploy table now
  says. The clamps in `chargedFor` and the NaN-proof gate are what landed here.
- **The function's time limit is assumed, not pinned.** A speech press takes at
  most about 41 seconds, and a chat turn on the same page about three minutes.
  Both fit Vercel's Fluid compute default of 300 seconds, which this project —
  created 2026-08-24, after Fluid became the default for new projects — is
  assumed to have; Vercel's API does not report it. It is not pinned with
  `maxDuration`: 300 on a Hobby project without Fluid fails the deploy, and 60
  would cut the chat off. If Fluid is ever off, a function killed mid-call writes
  no row for a call that may have been billed.

## Corrected after the first live calls, 2026-09-11

The first presses of Hear on the merged code failed twice over, and the ledger
said why each time — the design's own claim, that every attempt leaves a row
with its reason, is how both were found in minutes and for nothing:

1. **HTTP 402, "Insufficient credits."** The OpenRouter account had never held
   credit; no stage had ever made a live call. The owner added some.
2. **HTTP 400, "Gemini TTS only supports response_format=pcm. Got mp3."**
   OpenRouter's page for the model lists mp3 and pcm; the model accepts pcm only.
   Every mp3 request was refused before generation, so nothing was billed.

**The correction.** The gateway asks for `pcm` and wraps what comes back in a WAV
header — the same samples behind 44 bytes, so no encoder and no dependency — and
hands the browser `audio/wav`. The samples are 16-bit little-endian mono at
24 kHz, Google's documented output for this model; a `rate=` parameter on the
response's content type overrides the rate if the provider sends one. A 200
labelled anything but raw PCM (`audio/pcm`, or `audio/l16`, its registered
name) is still `schema_invalid`, charged and not retried. The addendum's "Only
mp3 is audio" was true of the request this code made and false of the model;
read it as "only the format asked for is audio".

**The cost of WAV:** 48 KB a second, so a ten- to fifteen-second line is 0.5 to
0.7 MB across the server action, the longest line about 1.4 MB. Fine for a
preview; the later PR that reads a whole plan aloud should reconsider it.

**Still open, and the owner noticed it:** the card said "The voice did not come
through. Try again in a moment." for both failures, and retrying fixes neither.
A refusal from the provider — no credit, a rejected request — deserves its own
line. Not built here.
