# ADR 0025 — A coach speaks in a synthesised character voice, through the gateway

**Status:** accepted, rework plan PR 6b
**Date:** 2026-09-11
**Supersedes:** [ADR 0006](0006-persona-boundary.md)'s "there is no TTS provider"
and its device-voice allocation, for coaches. ADR 0006 still governs what a
persona may SAY.

> Written before the code it governs, in its own commit.

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
uses, now serves text-to-speech at `POST /api/v1/audio/speech`, OpenAI-compatible
and priced per character. Behind it, `openai/gpt-4o-mini-tts` takes an
`instructions` field that steers tone, emotion, pace and accent per call. So a
coach's character can be written down and spoken, through the key and the
gateway the project already has.

## Decision

**A coach's voice is synthesised by a steerable TTS model, from a direction
stored in its row, through the gateway.**

1. **Content in the row** — CLAUDE.md #7. Each persona carries `tts_voice` (the
   provider's voice name) and `tts_instructions` (how the character speaks: "An
   old samurai sword master: deep, grave, unhurried…"). Provider-neutral in
   intent: a direction written for a person is what a real-time voice will need
   too.
2. **Through the gateway** — CLAUDE.md #2 and #3. A `speech` stage, and
   `callSpeech` beside `callLLM` in `src/llm/gateway.ts`: the same weekly budget
   gate, the same retries, an `llm_calls` row for every attempt, failures
   included. The per-character price is estimated in code, as
   `TIMEOUT_ASSUMED_COST_USD` already is, so the budget sees the spend.
3. **Known text only.** The server never speaks text the browser sends. This PR
   speaks a coach's own `sample_line`, looked up by slug under RLS. Reading a
   delivered plan aloud needs the delivery stored server-side first, and is the
   next PR. Otherwise any signed-in user could spend the project's key as a free
   TTS service, bounded only by the budget.
4. **No mismatched fallback.** No key, no budget left, or a failed call: the
   coach shows its line as text. It never falls back to a device voice. Device
   speech survives only for persona-less cues — the rest timer's "Rest over."
5. **The device-voice machinery goes.** `tts_voice_id` and `tts_voice_variant`,
   the variant allocation and the voice picker served coaches only; with coaches
   off device speech they have no consumer, so they are removed rather than left
   as columns that describe nothing.

## Cost

`gpt-4o-mini-tts` is about **$0.015 per minute** of audio — roughly $17 per
million characters. A sample line of ~130 characters is about **$0.002**; a
delivered plan read aloud, ~2,000 characters, about **$0.03**. The gateway's
default budget of **$0.50 per user per week** caps a user at a few hundred
previews. Automated tests cost nothing: they run against a scripted gateway with
no key, as every stage's do.

## What this does not decide, and where it is going

**The end goal is a coach that talks to the user live, mid-workout.** That is a
real-time speech-to-speech session, not this: CLAUDE.md puts real-time work out
of scope today, and nothing here builds it. What this ADR does is put each
coach's voice DIRECTION in the row, in words, so that session can reuse it
rather than start again.

Not decided: caching audio server-side (a replay costs a second call until it
is), and pre-rendered clips.

## Consequences

- **It speaks only once `OPENROUTER_API_KEY` is set**, in `.env.local` and on
  Vercel — the same condition as the other stages listed as blocked on the key.
  Until then the Voice card shows each line as text.
- A preview costs a network round trip, about a second, where device speech was
  instant. The button says so while it waits.
- Adding a coach now means writing a voice direction, and the add-persona skill
  says how.
