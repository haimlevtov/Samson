# ADR 0025 — A coach speaks in a synthesised character voice, through the gateway

**Status:** accepted, rework plan PR 6b
**Date:** 2026-09-11
**Supersedes:** [ADR 0006](0006-persona-boundary.md)'s "there is no TTS provider"
and its device-voice allocation, for coaches. ADR 0006 still governs what a
persona may SAY.

> Written before the code it governs, in its own commit — and corrected before
> that code, in a second one. See [Corrected before the code](#corrected-before-the-code-2026-09-11).

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
   gate, the same retries, an `llm_calls` row for every attempt, failures
   included.
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
   and is the next PR.
5. **No mismatched fallback.** No key, no budget left, or a failed call: the
   coach shows its line as text. It never falls back to a device voice. Device
   speech survives only for persona-less cues — the rest timer's "Rest over."
6. **The device-voice machinery goes.** `tts_voice_id` and `tts_voice_variant`,
   the variant allocation and the voice picker served coaches only; with coaches
   off device speech they have no consumer, so they are removed rather than left
   as columns that describe nothing.

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
read aloud, the next PR, is a minute or more; that PR has to replace the flat
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
